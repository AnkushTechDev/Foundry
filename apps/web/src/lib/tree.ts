import { createId, type ComponentNode, type ComponentType, type QueryDef } from "@foundry/shared";

export const PALETTE: Array<{ category: string; types: ComponentType[] }> = [
  { category: "Layout", types: ["Container", "Row", "Column", "Grid", "Card", "Tabs", "Divider"] },
  { category: "Type", types: ["Heading", "Text", "Label"] },
  { category: "Forms", types: ["Form", "Input", "Textarea", "Select", "Checkbox", "Radio", "Switch", "DatePicker", "Button"] },
  { category: "Data", types: ["Table", "List", "Badge", "Avatar", "Pagination"] },
  { category: "Media", types: ["Image", "Icon"] },
  { category: "Navigation", types: ["Navbar", "Sidebar", "Link"] },
  { category: "Feedback", types: ["Modal", "Drawer", "Alert", "Loader"] },
];

const PARENTS = new Set<ComponentType>(["Container", "Row", "Column", "Grid", "Card", "Tabs", "Form", "Modal", "Drawer", "Navbar", "Sidebar", "List"]);

export function ensureNode(node: ComponentNode): ComponentNode {
  return {
    ...node,
    props: node.props ?? {},
    children: (node.children ?? []).map(ensureNode),
  };
}

export function canHaveChildren(type: ComponentType) {
  return PARENTS.has(type);
}

export function createComponent(type: ComponentType): ComponentNode {
  const base = { id: createId(), type, props: {} as Record<string, unknown>, children: [] as ComponentNode[] };
  switch (type) {
    case "Heading":
      return { ...base, props: { text: "Heading", level: 2 } };
    case "Text":
      return { ...base, props: { text: "Describe this section." } };
    case "Label":
      return { ...base, props: { text: "Label" } };
    case "Button":
      return { ...base, props: { text: "Button", variant: "primary", buttonType: "button" } };
    case "Input":
      return { ...base, props: { name: "field", label: "Field", placeholder: "Enter a value", inputType: "text" } };
    case "Textarea":
      return { ...base, props: { name: "notes", label: "Notes", placeholder: "Write something" } };
    case "Select":
      return { ...base, props: { name: "status", label: "Status", options: ["new", "active"] } };
    case "Checkbox":
    case "Switch":
      return { ...base, props: { name: "active", label: "Active" } };
    case "Radio":
      return { ...base, props: { name: "plan", label: "Plan", options: ["free", "pro"] } };
    case "DatePicker":
      return { ...base, props: { name: "date", label: "Date" } };
    case "Form":
      return { ...base, props: { name: "create" }, style: { gap: 12 } };
    case "Table":
      return { ...base, props: { query: "customers", columns: [{ key: "name", header: "Name" }, { key: "email", header: "Email" }] } };
    case "Card":
      return { ...base, props: { title: "Card" }, style: { padding: 16, gap: 12 }, children: [createComponent("Text")] };
    case "Container":
    case "Column":
      return { ...base, style: { padding: 16, gap: 12 } };
    case "Row":
      return { ...base, style: { gap: 12 } };
    case "Image":
      return { ...base, props: { src: "", alt: "Image" } };
    case "Alert":
      return { ...base, props: { text: "Something needs attention.", tone: "info" } };
    case "Link":
      return { ...base, props: { text: "Open page", href: "/" } };
    case "Badge":
      return { ...base, props: { text: "New" } };
    case "Navbar":
      return { ...base, props: { title: "App" } };
    default:
      return base;
  }
}

export function findNode(root: ComponentNode, id: string): ComponentNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function updateNode(root: ComponentNode, id: string, updater: (node: ComponentNode) => ComponentNode): ComponentNode {
  if (root.id === id) return updater(root);
  return { ...root, children: root.children.map((child) => updateNode(child, id, updater)) };
}

export function removeNode(root: ComponentNode, id: string): ComponentNode {
  return { ...root, children: root.children.filter((child) => child.id !== id).map((child) => removeNode(child, id)) };
}

export function insertNode(root: ComponentNode, parentId: string, node: ComponentNode, index?: number): ComponentNode {
  if (root.id === parentId) {
    const children = [...root.children];
    children.splice(index ?? children.length, 0, node);
    return { ...root, children };
  }
  return { ...root, children: root.children.map((child) => insertNode(child, parentId, node, index)) };
}

export function duplicateNode(root: ComponentNode, id: string): ComponentNode {
  const clone = (node: ComponentNode): ComponentNode => ({
    ...node,
    id: createId(),
    props: { ...node.props },
    children: node.children.map(clone),
    actions: node.actions?.map((action) => ({ ...action, id: createId() })),
  });
  const walk = (node: ComponentNode): ComponentNode => {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
      const children = [...node.children];
      children.splice(index + 1, 0, clone(node.children[index]!));
      return { ...node, children };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return walk(root);
}

export function moveNode(root: ComponentNode, id: string, direction: -1 | 1): ComponentNode {
  const walk = (node: ComponentNode): ComponentNode => {
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
      const next = index + direction;
      if (next < 0 || next >= node.children.length) return node;
      const children = [...node.children];
      const [item] = children.splice(index, 1);
      children.splice(next, 0, item!);
      return { ...node, children };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return walk(root);
}

export function countNodes(root: ComponentNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function blankPage(name = "Home"): {
  name: string;
  slug: string;
  path: string;
  title: string;
  auth: "public";
  queries: QueryDef[];
  variables: Record<string, unknown>;
  root: ComponentNode;
} {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
  return {
    name,
    slug,
    path: slug === "home" ? "/" : `/${slug}`,
    title: name,
    auth: "public",
    queries: [],
    variables: {},
    root: {
      id: createId(),
      type: "Container",
      props: {},
      style: { padding: 28, gap: 16 },
      children: [createComponent("Heading")],
    },
  };
}
