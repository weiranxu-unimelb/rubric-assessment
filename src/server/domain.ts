export type IndicatorNode = {
  id: string;
  parentId: string | null;
  name: string;
  maxScore: number;
};

export function validateIndicatorTree(nodes: IndicatorNode[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, IndicatorNode>();

  for (const node of nodes) {
    if (seen.has(node.id)) errors.push(`${node.name}：节点编码重复`);
    seen.add(node.id);
    byId.set(node.id, node);
    if (!node.name.trim()) errors.push(`${node.id}：名称不能为空`);
    if (!Number.isFinite(node.maxScore) || node.maxScore <= 0) errors.push(`${node.name}：满分必须大于 0`);
  }

  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) errors.push("指标树必须有且只有一个根节点");
  if (roots[0] && roots[0].maxScore !== 100) errors.push(`${roots[0].name}：根节点满分必须为 100`);

  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      errors.push(`${node.name}：父节点不存在`);
    }
    const path = new Set<string>();
    let cursor: IndicatorNode | undefined = node;
    while (cursor) {
      if (path.has(cursor.id)) {
        errors.push(`${node.name}：存在循环引用`);
        break;
      }
      path.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    const children = nodes.filter((child) => child.parentId === node.id);
    if (children.length > 0) {
      const sum = children.reduce((total, child) => total + child.maxScore, 0);
      if (Math.abs(sum - node.maxScore) > 0.000001) {
        errors.push(`${node.name}：子项满分合计应为 ${node.maxScore}，实际为 ${sum}`);
      }
    }
  }

  return [...new Set(errors)];
}

export function calculateFinalScore(scores: number[]): number {
  if (scores.length === 0 || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 100)) {
    throw new Error("有效打分人分数不能为空，且必须在 0–100 之间");
  }
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100;
}
