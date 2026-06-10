#!/usr/bin/env python3
"""
ResellBuddy & Extensions — Pre-Submission Audit Workflow
=========================================================
Run this before submitting ANY extension to Edge Add-ons, Chrome Web Store, or any store.

Usage:
  python3 audit-extensions.py [--fix] [--verbose]

Exit codes:
  0 = All checks pass (or all fixable issues fixed with --fix)
  1 = Critical issues found that must be fixed manually
"""

import json
import os
import re
import sys
import zipfile
import tempfile
import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# ── Config ──────────────────────────────────────────────────────────────────

EXTENSIONS_DIR = Path.home() / "Extensions-Ready"
RESELL_BUDDY_DIR = Path.home() / "Projects" / "resell-buddy"
DEVTOOLS_DIR = Path.home() / "Projects" / "devtools-site"

# Edge/CWS required icon sizes
REQUIRED_ICON_SIZES = [16, 48, 128]

# Dangerous permissions that trigger manual review
SENSITIVE_PERMISSIONS = {
    "cookies", "webNavigation", "webRequest", "webRequestBlocking",
    "browsingData", "clipboardRead", "clipboardWrite", "debugger",
    "downloads", "geolocation", "history", "management", "nativeMessaging",
    "proxy", "tabHide", "topSites", "tts", "identity"
}

# Permissions that are generally safe
SAFE_PERMISSIONS = {
    "activeTab", "storage", "tabs", "scripting", "alarms",
    "contextMenus", "notifications", "sidePanel"
}

# Minimum manifest fields for store submission
REQUIRED_MANIFEST_FIELDS = [
    "manifest_version", "name", "version", "description",
    "action", "icons"
]

# ── Data Classes ────────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    name: str
    status: str  # "PASS", "WARN", "FAIL", "FIXED"
    message: str
    fix_hint: Optional[str] = None

@dataclass
class ExtensionAudit:
    path: Path
    manifest: dict = field(default_factory=dict)
    results: list[CheckResult] = field(default_factory=list)
    file_list: list[str] = field(default_factory=list)
    js_content: dict[str, str] = field(default_factory=dict)  # filename -> content

    @property
    def name(self) -> str:
        return self.path.stem

    @property
    def ext_name(self) -> str:
        return self.manifest.get("name", self.name)

    @property
    def version(self) -> str:
        return self.manifest.get("version", "?")

    def add(self, name: str, status: str, message: str, fix_hint: str = None):
        self.results.append(CheckResult(name, status, message, fix_hint))

    @property
    def pass_count(self): return sum(1 for r in self.results if r.status in ("PASS", "FIXED"))
    @property
    def warn_count(self): return sum(1 for r in self.results if r.status == "WARN")
    @property
    def fail_count(self): return sum(1 for r in self.results if r.status == "FAIL")

# ── Audit Functions ─────────────────────────────────────────────────────────

def audit_zip_structure(audit: ExtensionAudit):
    """Check 1: ZIP structure and manifest validity"""
    # Can open as ZIP?
    try:
        with zipfile.ZipFile(audit.path) as zf:
            audit.file_list = zf.namelist()
    except zipfile.BadZipFile:
        audit.add("ZIP valid", "FAIL", "File is not a valid ZIP archive")
        return False

    audit.add("ZIP valid", "PASS", f"Valid ZIP with {len(audit.file_list)} files")

    # Has manifest.json?
    if "manifest.json" not in audit.file_list:
        audit.add("manifest.json", "FAIL", "No manifest.json in ZIP root")
        return False

    # Parse manifest
    try:
        with zipfile.ZipFile(audit.path) as zf:
            raw = zf.read("manifest.json").decode("utf-8")
            audit.manifest = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        audit.add("manifest.json parse", "FAIL", f"Invalid JSON: {e}")
        return False

    audit.add("manifest.json parse", "PASS", "Valid JSON manifest")
    return True

def audit_manifest_fields(audit: ExtensionAudit):
    """Check 2: Required manifest fields for store submission"""
    for field_name in REQUIRED_MANIFEST_FIELDS:
        if field_name not in audit.manifest:
            audit.add(f"manifest.{field_name}", "FAIL",
                      f"Missing required field: {field_name}",
                      f"Add \"{field_name}\" to manifest.json")

        elif field_name == "description" and len(audit.manifest["description"]) < 20:
            audit.add("manifest.description length", "WARN",
                      f"Description too short ({len(audit.manifest['description'])} chars). "
                      f"Stores prefer 132+ chars.",
                      "Write a detailed description (132-132 chars recommended)")
        else:
            val = audit.manifest[field_name]
            if isinstance(val, str):
                display = val[:60] + "..." if len(val) > 60 else val
            else:
                display = str(val)[:60]
            audit.add(f"manifest.{field_name}", "PASS", display)

    # Check manifest_version is 3
    mv = audit.manifest.get("manifest_version")
    if mv == 2:
        audit.add("manifest_version", "FAIL",
                  "Manifest V2 is deprecated. Stores require V3.",
                  "Migrate to manifest_version: 3")
    elif mv == 3:
        audit.add("manifest_version MV3", "PASS", "Manifest V3 ✓")

    # Version format check
    version = audit.manifest.get("version", "")
    if re.match(r"^\d+(\.\d+){0,3}$", version):
        audit.add("version format", "PASS", f"Valid version: {version}")
    else:
        audit.add("version format", "FAIL",
                  f"Invalid version format: '{version}'. Must be 1-4 dot-separated integers.",
                  f"Change to format like '1.0.0'")

    # Name length
    name = audit.manifest.get("name", "")
    if len(name) > 45:
        audit.add("name length", "WARN",
                  f"Name is {len(name)} chars — may be truncated in store listings (max ~75)")
    elif len(name) < 5:
        audit.add("name length", "FAIL", "Name too short", "Use a descriptive name")
    else:
        audit.add("name length", "PASS", f"Name: {name}")

def audit_icons(audit: ExtensionAudit):
    """Check 3: Icons exist and referenced correctly"""
    icons = audit.manifest.get("icons", {})
    if not icons:
        audit.add("icons", "FAIL", "No icons defined in manifest",
                  "Add icons field with 16, 48, 128 sizes")
        return

    with zipfile.ZipFile(audit.path) as zf:
        for size in REQUIRED_ICON_SIZES:
            str_size = str(size)
            if str_size not in icons:
                audit.add(f"icon {size}x{size}", "WARN",
                          f"Missing {size}x{size} icon — stores require all 3 sizes",
                          f"Add a {size}x{size} icon")
                continue

            icon_path = icons[str_size]
            if icon_path not in audit.file_list:
                audit.add(f"icon {size}x{size} file", "FAIL",
                          f"manifest references '{icon_path}' but file not in ZIP",
                          f"Add the icon file or fix the path")
            else:
                # Check file is a valid PNG
                try:
                    data = zf.read(icon_path)
                    if data[:8] != b'\x89PNG\r\n\x1a\n':
                        audit.add(f"icon {size}x{size} format", "WARN",
                                  f"File '{icon_path}' may not be a valid PNG")
                    else:
                        audit.add(f"icon {size}x{size}", "PASS",
                                  f"Valid PNG icon: {icon_path} ({len(data)} bytes)")
                except Exception as e:
                    audit.add(f"icon {size}x{size} read", "FAIL", f"Cannot read icon: {e}")

def audit_permissions(audit: ExtensionAudit):
    """Check 4: Permissions are minimal and justified"""
    perms = audit.manifest.get("permissions", [])
    host_perms = audit.manifest.get("host_permissions", [])

    if not perms:
        audit.add("permissions", "PASS", "No permissions requested (minimal)")
    else:
        audit.add("permissions declared", "PASS", f"Permissions: {', '.join(perms)}")

    # Flag sensitive permissions
    sensitive_found = [p for p in perms if p in SENSITIVE_PERMISSIONS]
    if sensitive_found:
        audit.add("sensitive permissions", "WARN",
                  f"Uses sensitive permissions: {', '.join(sensitive_found)}. "
                  f"These trigger manual review and require justification in privacy policy.",
                  "Only request if absolutely needed. Document why in store listing.")
    else:
        audit.add("sensitive permissions", "PASS", "No sensitive permissions")

    # Flag unknown permissions
    all_known = SAFE_PERMISSIONS | SENSITIVE_PERMISSIONS | {
        "cookies",  # known but sensitive
    }
    unknown = [p for p in perms if p not in all_known and not p.startswith("_")]
    if unknown:
        audit.add("unknown permissions", "WARN",
                  f"Unknown/unchecked permissions: {', '.join(unknown)}")
    else:
        audit.add("permission coverage", "PASS", "All permissions recognized")

    # Host permissions
    if host_perms:
        if "<all_urls>" in host_perms:
            audit.add("host_permissions", "WARN",
                      "Requests <all_urls> — broad host access. "
                      "Stores scrutinize this heavily.",
                      "Narrow to specific domains if possible")
        else:
            audit.add("host_permissions", "PASS",
                      f"Scoped to: {', '.join(host_perms)}")
    else:
        audit.add("host_permissions", "PASS", "No host permissions needed")

def audit_code_quality(audit: ExtensionAudit):
    """Check 5: JS code basic quality checks"""
    with zipfile.ZipFile(audit.path) as zf:
        js_files = [f for f in audit.file_list if f.endswith('.js')]

        # Also check inline JS in HTML files
        html_files = [f for f in audit.file_list if f.endswith('.html')]

        if not js_files and not html_files:
            audit.add("code presence", "WARN",
                      "No JS or HTML files found — extension may have no functionality")
            return

        audit.add("code presence", "PASS",
                  f"Found {len(js_files)} JS files, {len(html_files)} HTML files")

        all_js = ""
        for f in js_files:
            try:
                content = zf.read(f).decode("utf-8", errors="replace")
                audit.js_content[f] = content
                all_js += content + "\n"
            except Exception:
                pass

        # Extract inline JS from HTML
        for f in html_files:
            try:
                content = zf.read(f).decode("utf-8", errors="replace")
                # Find <script> blocks
                scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
                for s in scripts:
                    if s.strip():
                        all_js += s + "\n"
            except Exception:
                pass

        if not all_js.strip():
            audit.add("JS content", "WARN", "No JavaScript code found in any file")
            return

        # Check for eval() — forbidden by most stores
        if re.search(r'\beval\s*\(', all_js):
            audit.add("eval usage", "FAIL",
                      "Uses eval() — forbidden by Edge/CWS policies (obfuscation risk)",
                      "Replace eval() with safe alternatives")
        else:
            audit.add("eval usage", "PASS", "No eval() usage")

        # Check for innerHTML with user input (XSS risk)
        innerhtml_count = len(re.findall(r'\.innerHTML\s*=', all_js))
        if innerhtml_count > 0:
            audit.add("innerHTML usage", "WARN",
                      f"Found {innerhtml_count} innerHTML assignment(s). "
                      f"Review for XSS vulnerabilities.",
                      "Prefer textContent or use DOMPurify")
        else:
            audit.add("innerHTML usage", "PASS", "No direct innerHTML usage")

        # Check for remote code loading (CSP violation)
        remote_patterns = [
            (r'fetch\s*\(\s*["\']https?://', "fetch to remote URL"),
            (r'XMLHttpRequest', "XMLHttpRequest (review for remote calls)"),
            (r'chrome\.scripting\.executeScript\s*\(\s*\{[^}]*url',
             "chrome.scripting.executeScript with URL"),
            (r'<script\s+src=["\']https?://', "External script tag in HTML"),
        ]
        remote_found = []
        for pattern, label in remote_patterns:
            if re.search(pattern, all_js):
                remote_found.append(label)

        if remote_found:
            audit.add("remote code", "WARN",
                      f"Potential remote code loading: {', '.join(remote_found)}. "
                      f"CSP policy may block. Review if necessary.",
                      "Ensure no remote scripts are loaded/executed")
        else:
            audit.add("remote code", "PASS", "No remote code loading detected")

        # Check for console.log in production (unprofessional but not blocking)
        console_logs = len(re.findall(r'console\.log\s*\(', all_js))
        if console_logs > 5:
            audit.add("console.log count", "WARN",
                      f"Found {console_logs} console.log calls — consider removing for production",
                      "Remove or guard with DEBUG flag")

def audit_content_scripts(audit: ExtensionAudit):
    """Check 6: Content scripts have proper matches"""
    content_scripts = audit.manifest.get("content_scripts", [])
    if not content_scripts:
        audit.add("content_scripts", "PASS", "No content scripts (popup-only extension)")
        return

    for i, cs in enumerate(content_scripts):
        matches = cs.get("matches", [])
        if not matches:
            audit.add(f"content_script[{i}] matches", "FAIL",
                      "Content script has no matches", "Add URL patterns")
            continue

        if "<all_urls>" in matches:
            audit.add(f"content_script[{i}] scope", "WARN",
                      "Content script matches <all_urls> — broad injection. "
                      "Stores will scrutinize.",
                      "Narrow to specific domains")
        else:
            audit.add(f"content_script[{i}] scope", "PASS",
                      f"Matches: {', '.join(matches[:3])}")

        js_files = cs.get("js", [])
        for jf in js_files:
            if jf not in audit.file_list:
                audit.add(f"content_script[{i}] file", "FAIL",
                          f"Referenced file '{jf}' not in ZIP")

def audit_functionality(audit: ExtensionAudit):
    """Check 7: Extension has actual functionality"""
    has_popup = "action" in audit.manifest or "browser_action" in audit.manifest
    has_bg = "background" in audit.manifest
    has_cs = bool(audit.manifest.get("content_scripts", []))

    features = []
    if has_popup: features.append("popup")
    if has_bg: features.append("background")
    if has_cs: features.append("content scripts")

    if not features:
        audit.add("functionality", "FAIL",
                  "Extension has no popup, background, or content scripts — does nothing",
                  "Add actual functionality")
    else:
        audit.add("functionality", "PASS",
                  f"Active features: {', '.join(features)}")

    # Check popup HTML exists
    popup_path = audit.manifest.get("action", {}).get("default_popup", "")
    if popup_path:
        if popup_path in audit.file_list:
            audit.add("popup file", "PASS", f"Popup: {popup_path}")
        else:
            audit.add("popup file", "FAIL",
                      f"Popup file '{popup_path}' not in ZIP",
                      "Add the popup HTML file")

def audit_privacy_readiness(audit: ExtensionAudit):
    """Check 8: Privacy policy readiness (not checking the policy itself)"""
    perms = audit.manifest.get("permissions", [])
    host_perms = audit.manifest.get("host_permissions", [])
    has_storage = "storage" in perms
    has_cookies = "cookies" in perms
    has_host = bool(host_perms)
    collects_data = has_storage or has_cookies or has_host

    if collects_data:
        audit.add("privacy policy needed", "WARN",
                  "Extension collects/accesses data. "
                  "Edge and CWS require a privacy policy URL at submission.",
                  "Create a privacy policy page (can use privacy-policy tool on hub)")
    else:
        audit.add("privacy policy needed", "PASS",
                  "Extension doesn't collect personal data — minimal privacy requirements")

def audit_store_listing_readiness(audit: ExtensionAudit):
    """Check 9: Store listing metadata quality"""
    desc = audit.manifest.get("description", "")
    name = audit.manifest.get("name", "")

    # Description quality
    if len(desc) < 50:
        audit.add("description quality", "FAIL",
                  f"Description too short ({len(desc)} chars). Stores want 132+ chars.",
                  "Write a detailed description of what the extension does")
    elif len(desc) < 132:
        audit.add("description quality", "WARN",
                  f"Description could be longer ({len(desc)} chars). "
                  f"Aim for 132-300 chars for best store listing.",
                  "Expand description with features, benefits, and use cases")
    else:
        audit.add("description quality", "PASS",
                  f"Description length: {len(desc)} chars ✓")

    # Name doesn't reference other browsers
    browser_refs = re.findall(r'\b(chrome|firefox|safari|opera|edge)\b', name, re.I)
    if browser_refs:
        audit.add("name browser reference", "FAIL",
                  f"Name references browser: {browser_refs[0]}. "
                  f"Edge policy: must not reference other browsers.",
                  "Remove browser name from extension name")
    else:
        audit.add("name browser reference", "PASS", "No browser name in extension name")

    # Description doesn't reference competitors
    competitor_refs = re.findall(r'\b(competitor|other extension|better than)\b', desc, re.I)
    if competitor_refs:
        audit.add("description competitor ref", "WARN",
                  "Description may contain competitive claims")
    else:
        audit.add("description competitor ref", "PASS", "No competitive claims")

def audit_resellbuddy_specific(audit: ExtensionAudit):
    """Check 10: ResellBuddy-specific compliance checks"""
    if "resell" not in audit.name.lower():
        return  # Not ResellBuddy, skip

    # Check ExtPay integration
    has_extpay = any("ExtPay" in f or "extpay" in f for f in audit.file_list)
    if has_extpay:
        audit.add("ExtPay integration", "PASS", "ExtPay payment integration present")
    else:
        audit.add("ExtPay integration", "WARN",
                  "No ExtPay found — payment handling may be missing")

    # Check for automation disclaimers in description
    desc = audit.manifest.get("description", "")
    if "automat" in desc.lower():
        audit.add("automation disclosure", "WARN",
                  "Description mentions 'automation'. "
                  "Edge policy 1.1.7: 'bots' that perform automated actions to manipulate "
                  "platform features may be flagged. Ensure description clearly states "
                  "user-initiated actions with consent.",
                  "Emphasize user-initiated, user-controlled actions in description")

    # Check host permissions are scoped
    host_perms = audit.manifest.get("host_permissions", [])
    scoped = all("poshmark.com" in p or "mercari.com" in p or "depop.com" in p
                 for p in host_perms if p != "<all_urls>")
    if scoped:
        audit.add("host scope", "PASS", "Host permissions scoped to specific platforms")
    else:
        audit.add("host scope", "WARN",
                  "Host permissions not fully scoped to supported platforms")

# ── Cloudflare Pages Audit ──────────────────────────────────────────────────

def audit_tool_site(url: str, name: str) -> list[CheckResult]:
    """Audit a deployed tool site for functionality"""
    results = []
    import urllib.request
    import urllib.error

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            html = resp.read().decode("utf-8", errors="replace")

        results.append(CheckResult("HTTP status", "PASS", f"{status} OK"))

        # Check has <title>
        title_match = re.search(r'<title>(.*?)</title>', html, re.I | re.S)
        if title_match and title_match.group(1).strip():
            results.append(CheckResult("title tag", "PASS",
                                       title_match.group(1).strip()[:60]))
        else:
            results.append(CheckResult("title tag", "WARN", "Missing or empty <title>",
                                       "Add a descriptive <title>"))

        # Check has meta description
        meta_desc = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
                              html, re.I)
        if meta_desc and meta_desc.group(1).strip():
            results.append(CheckResult("meta description", "PASS",
                                       meta_desc.group(1)[:60] + "..."))
        else:
            results.append(CheckResult("meta description", "WARN",
                                       "Missing meta description — hurts SEO",
                                       "Add <meta name='description'>"))

        # Check has interactive JS (not just static HTML)
        has_js = bool(re.search(r'<script|onclick|addEventListener|document\.', html))
        if has_js:
            results.append(CheckResult("JS interactivity", "PASS", "JavaScript present"))
        else:
            results.append(CheckResult("JS interactivity", "WARN",
                                       "No JavaScript detected — tool may be non-functional"))

        # Check for copy/export buttons
        has_copy = bool(re.search(r'copy|clipboard|export', html, re.I))
        if has_copy:
            results.append(CheckResult("copy/export", "PASS", "Copy or export functionality present"))
        else:
            results.append(CheckResult("copy/export", "WARN",
                                       "No copy/export buttons found",
                                       "Add copy-to-clipboard functionality"))

    except urllib.error.HTTPError as e:
        results.append(CheckResult("HTTP status", "FAIL",
                                    f"HTTP {e.code} — site not accessible"))
    except Exception as e:
        results.append(CheckResult("site access", "FAIL", f"Cannot access: {e}"))

    return results

# ── Reporting ───────────────────────────────────────────────────────────────

COLORS = {
    "PASS": "\033[92m",   # green
    "WARN": "\033[93m",   # yellow
    "FAIL": "\033[91m",   # red
    "FIXED": "\033[96m",  # cyan
    "RESET": "\033[0m",
}

ICONS = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌", "FIXED": "🔧"}

def print_audit_report(audit: ExtensionAudit):
    c = COLORS
    r = c["RESET"]

    print(f"\n{'='*60}")
    print(f"  📦 {audit.ext_name} v{audit.version}")
    print(f"  📁 {audit.path.name}")
    print(f"{'='*60}")

    for result in audit.results:
        icon = ICONS.get(result.status, "?")
        color = COLORS.get(result.status, "")
        print(f"  {icon} {color}{result.name:<35}{r} {result.message[:70]}")
        if result.fix_hint and result.status in ("WARN", "FAIL"):
            print(f"     💡 {result.fix_hint}")

    print(f"\n  📊 Summary: {audit.pass_count} pass, {audit.warn_count} warn, {audit.fail_count} fail")

def print_site_audit(name: str, url: str, results: list[CheckResult]):
    c = COLORS
    r = c["RESET"]
    print(f"\n  🌐 {name}: {url}")
    for result in results:
        icon = ICONS.get(result.status, "?")
        color = COLORS.get(result.status, "")
        print(f"    {icon} {color}{result.name:<30}{r} {result.message[:60]}")

# ── Main ────────────────────────────────────────────────────────────────────

def main():
    fix_mode = "--fix" in sys.argv
    verbose = "--verbose" in sys.argv

    total_pass = 0
    total_warn = 0
    total_fail = 0

    print("╔══════════════════════════════════════════════════════════╗")
    print("║  🔍 Extension & Tool Pre-Submission Audit Workflow     ║")
    print("║  Edge Add-ons / Chrome Web Store / Firefox Add-ons     ║")
    print("╚══════════════════════════════════════════════════════════╝")

    # ── Phase 1: Audit Extension ZIPs ──
    print(f"\n{'─'*60}")
    print("  Phase 1: Extension ZIP Audits")
    print(f"{'─'*60}")

    zips = sorted(EXTENSIONS_DIR.glob("*.zip"))
    if not zips:
        print("  ⚠️  No ZIP files found in", EXTENSIONS_DIR)
    else:
        # Only audit latest version of each extension
        latest = {}
        for z in zips:
            # Extract base name (without version)
            base = re.sub(r'-v[\d.]+', '', z.stem)
            if base not in latest or z > latest[base]:
                latest[base] = z

        for base, path in sorted(latest.items()):
            audit = ExtensionAudit(path)

            # Run all checks
            if not audit_zip_structure(audit):
                print_audit_report(audit)
                continue

            audit_manifest_fields(audit)
            audit_icons(audit)
            audit_permissions(audit)
            audit_code_quality(audit)
            audit_content_scripts(audit)
            audit_functionality(audit)
            audit_privacy_readiness(audit)
            audit_store_listing_readiness(audit)
            audit_resellbuddy_specific(audit)

            print_audit_report(audit)
            total_pass += audit.pass_count
            total_warn += audit.warn_count
            total_fail += audit.fail_count

    # ── Phase 2: Audit Deployed Tool Sites ──
    print(f"\n{'─'*60}")
    print("  Phase 2: Deployed Tool Site Spot-Check")
    print(f"{'─'*60}")

    # Check a sample of tool sites
    tool_sites = {
        "ResellBuddy Landing": "https://resellbuddy.pages.dev/",
        "DevTools Hub": "https://devtools-site-cos.pages.dev/",
        "Products Page": "https://products-page.pages.dev/",
        "Blog": "https://chesten-blog.pages.dev/",
    }

    for name, url in tool_sites.items():
        results = audit_tool_site(url, name)
        print_site_audit(name, url, results)
        for r in results:
            total_pass += 1 if r.status == "PASS" else 0
            total_warn += 1 if r.status == "WARN" else 0
            total_fail += 1 if r.status == "FAIL" else 0

    # ── Phase 3: Summary ──
    print(f"\n{'═'*60}")
    print(f"  📊 TOTAL: {total_pass} pass | {total_warn} warn | {total_fail} fail")
    print(f"{'═'*60}")

    if total_fail > 0:
        print(f"\n  ❌ {total_fail} CRITICAL issue(s) must be fixed before submission.")
        print("     Fix the FAIL items above and re-run this audit.")
        return 1
    elif total_warn > 0:
        print(f"\n  ⚠️  {total_warn} warning(s) found. Not blocking, but review recommended.")
        return 0
    else:
        print(f"\n  ✅ ALL CHECKS PASSED. Ready for store submission!")
        return 0

if __name__ == "__main__":
    sys.exit(main())
