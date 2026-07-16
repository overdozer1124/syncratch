declare module "css-tree" {
  export interface CssNode {
    type: string;
    name?: string;
    value?: unknown;
  }

  export interface ListItem<T extends CssNode> {
    data: T;
  }

  export interface List<T extends CssNode> {
    remove(item: ListItem<T>): void;
  }

  export function parse(
    source: string,
    options?: { context?: string },
  ): CssNode;

  export function walk<T extends CssNode>(
    ast: T,
    enter: (node: T, item: ListItem<T>, list: List<T>) => void,
  ): void;
}
