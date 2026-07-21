const SCRATCH_LABELS: Readonly<Record<string, string>> = {
  "Code editor panel": "コード編集エリア",
  Delete: "削除",
  "Edit menu": "編集メニュー",
  Editor: "エディター",
  "File menu": "ファイルメニュー",
  Home: "ホーム",
  "Menu topbar": "上のメニュー",
  "Settings menu": "設定メニュー",
  Stage: "ステージ",
  "Stage and target": "ステージとスプライト",
  "Start project": "作品を動かす",
  "Stop project": "作品を止める",
  "Tab list": "タブ一覧",
  "Target pane": "スプライト一覧",
};

export function japaneseScratchLabel(label: string): string {
  return SCRATCH_LABELS[label] ?? label;
}

function localizeElement(element: Element): void {
  for (const attribute of ["aria-label", "title"] as const) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    if (value === "undefined") {
      element.removeAttribute(attribute);
      continue;
    }
    const localized = japaneseScratchLabel(value);
    if (localized !== value) element.setAttribute(attribute, localized);
  }
}

function localizeTree(root: ParentNode): void {
  if (root instanceof Element) localizeElement(root);
  for (const element of root.querySelectorAll("[aria-label], [title]")) {
    localizeElement(element);
  }
}

export function installScratchAccessibility(root: HTMLElement): () => void {
  localizeTree(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        localizeElement(record.target as Element);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) localizeTree(node);
      }
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["aria-label", "title"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
