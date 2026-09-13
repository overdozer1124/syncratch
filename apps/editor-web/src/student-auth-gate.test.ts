import {describe, expect, it, vi} from "vitest";
import type {StudentPolicyView} from "@blocksync/classroom-access";
import {
  hideStudentAuthShell,
  shouldShowStudentAuthGate,
  showStudentAuthShell,
} from "./student-auth-gate.js";

function policy(overrides: Partial<StudentPolicyView> = {}): StudentPolicyView {
  return {
    policyId: "p1",
    title: "class",
    studentAuth: {required: false},
    submission: {enabled: false},
    aiAssist: {enabled: false, level: 2, allowStudentApiKey: false},
    editor: {
      showSettingsPanel: false,
      allowSb3Export: true,
      allowSb3Import: true,
      allowExtensions: true,
    },
    collab: {allow: true},
    drive: {allow: false},
    ...overrides,
  };
}

type MockElement = {
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  children: MockElement[];
  classList: {add: (name: string) => void; toggle: (name: string, on?: boolean) => void};
  setAttribute: (name: string, value: string) => void;
  append: (...nodes: MockElement[]) => void;
  replaceChildren?: (...nodes: MockElement[]) => void;
  addEventListener: () => void;
  matches: (selector: string) => boolean;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
};

function createMockElement(tag: string): MockElement {
  const node: MockElement = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    children: [],
    classList: {
      add(name: string) {
        node.className = node.className ? `${node.className} ${name}` : name;
      },
      toggle(name: string, on?: boolean) {
        const has = node.className.split(/\s+/).includes(name);
        const next = on ?? !has;
        if (next && !has) node.classList.add(name);
        if (!next && has) {
          node.className = node.className
            .split(/\s+/)
            .filter(part => part !== name)
            .join(" ");
        }
      },
    },
    setAttribute() {},
    append(...nodes: MockElement[]) {
      node.children.push(...nodes);
    },
    addEventListener() {},
    matches(selector: string) {
      if (selector.startsWith(".")) {
        return node.className.split(/\s+/).includes(selector.slice(1));
      }
      return selector.toLowerCase() === tag.toLowerCase();
    },
    querySelector(selector: string) {
      if (node.matches(selector)) return node;
      for (const child of node.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      const out: MockElement[] = [];
      const walk = (current: MockElement) => {
        if (current.matches(selector)) out.push(current);
        for (const child of current.children) walk(child);
      };
      walk(node);
      return out;
    },
  };
  return node;
}

function createShellRoot(): HTMLElement {
  const root = createMockElement("div");
  root.replaceChildren = (...nodes: MockElement[]) => {
    root.children = [...nodes];
  };
  Object.defineProperty(root, "childElementCount", {
    get() {
      return root.children.length;
    },
  });
  return root as unknown as HTMLElement;
}

describe("student auth gate", () => {
  it("shows gate only when studentAuth.required is true", () => {
    expect(shouldShowStudentAuthGate(policy())).toBe(false);
    expect(
      shouldShowStudentAuthGate(policy({studentAuth: {required: true}})),
    ).toBe(true);
  });

  it("renders login/activate auth UI shell", () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        const el = createMockElement(tag);
        if (tag === "form") {
          Object.assign(el, {
            innerHTML: "",
            addEventListener: () => {},
          });
        }
        return el;
      },
    });
    const root = createShellRoot();
    const onAuthenticated = vi.fn();
    showStudentAuthShell(root, {onAuthenticated});
    expect(root.hidden).toBe(false);
    expect(root.querySelector("h1")?.textContent).toBe("ログインが必要です");
    expect(root.querySelectorAll(".student-auth-shell-tab")).toHaveLength(2);
    expect(root.querySelector(".student-auth-form")).not.toBeNull();
    hideStudentAuthShell(root);
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    vi.unstubAllGlobals();
  });
});
