'use strict';
const vscode = require('vscode');
const path = require('path');

const SEVERITY_ORDER = { error: 0, warning: 1, manual: 2, info: 3 };
const SEVERITY_ICON = { error: 'error', warning: 'warning', manual: 'info', info: 'circle-outline' };

function countBySeverity(findings) {
  const c = { error: 0, warning: 0, manual: 0, info: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] || 0) + 1;
  return c;
}

class FindingsProvider {
  constructor(state) {
    this.state = state;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._fileItems = new Map(); // file path -> stable TreeItem (for reveal/getParent)
  }
  refresh() { this._onDidChangeTreeData.fire(); }
  getTreeItem(el) { return el; }
  getParent(el) {
    if (el && el._parentFile) return this._fileItems.get(el._parentFile) || null;
    return null;
  }
  getChildren(el) {
    const scan = this.state.current;
    if (!scan) return [];
    if (!el) {
      // Root: one node per scanned file (files with zero findings included,
      // marked as passed - empty is never hidden as "everything is perfect").
      const files = Object.keys(scan.perFile);
      this._fileItems.clear();
      return files.map((f) => {
        const per = scan.perFile[f];
        const count = scan.findings.filter((x) => x.file === f).length;
        const item = new vscode.TreeItem(path.basename(f), vscode.TreeItemCollapsibleState.Collapsed);
        const rel = vscode.workspace.asRelativePath(f);
        item.description = per.error
          ? 'scan failed'
          : count === 0
            ? `no findings (${rel})`
            : `${count} finding(s) (${rel})`;
        item.tooltip = per.error ? `${f}\n${per.error}` : f;
        item.iconPath = new vscode.ThemeIcon(per.error ? 'warning' : count === 0 ? 'pass' : 'file');
        item.contextValue = 'file';
        item.resourceUri = vscode.Uri.file(f);
        this._fileItems.set(f, item);
        return item;
      });
    }
    if (el.contextValue === 'file') {
      const file = el.resourceUri.fsPath;
      const findings = this.state.current.findings
        .filter((f) => f.file === file)
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
      return findings.map((f) => {
        const pending = this.state.pendingPreviews && this.state.pendingPreviews[f.id];
        const item = new vscode.TreeItem(f.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(SEVERITY_ICON[f.severity] || 'circle-outline');
        item.description = f.tool;
        item.tooltip = `${f.message}\n\nCheck: ${f.tool}\nScope: ${f.scope}${f.detail ? `\nEvidence: ${f.detail}` : ''}`;
        item.contextValue = pending ? 'finding-pending' : f.fixable ? 'finding-fixable' : f.severity === 'manual' ? 'finding-manual' : 'finding';
        item._parentFile = file;
        item.finding = f;
        item.command = { command: 'website-audit.openFinding', title: 'Open', arguments: [f] };
        return item;
      });
    }
    return [];
  }
}

function publishDiagnostics(diagnostics, scan) {
  diagnostics.clear();
  const byFile = new Map();
  for (const f of scan.findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    const sev = f.severity === 'error' ? vscode.DiagnosticSeverity.Error
      : f.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
    // These are rendered-page findings; the engine does not map them to source
    // lines, so they anchor at the top of the file with the evidence in the message.
    const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), f.message, sev);
    d.source = 'Website Audit';
    d.code = f.rule;
    byFile.get(f.file).push(d);
  }
  for (const [file, diags] of byFile) diagnostics.set(vscode.Uri.file(file), diags);
}

module.exports = { FindingsProvider, publishDiagnostics, countBySeverity };
