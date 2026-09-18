export type IndicatorChildDraft = {
  name: string;
  description: string;
  scoringRule: string;
  maxScore: string;
};

export type IndicatorGroupDraft = IndicatorChildDraft & {
  children: IndicatorChildDraft[];
};

export type IndicatorNodeInput = {
  nodeCode: string;
  parentCode: string | null;
  name: string;
  description: string;
  scoringRule: string;
  maxScore: number;
  sortOrder: number;
};

function score(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function validateIndicatorHierarchy(groups: IndicatorGroupDraft[]) {
  const errors: string[] = [];
  const total = groups.reduce((sum, group) => sum + score(group.maxScore), 0);
  if (Math.abs(total - 100) > 0.001) errors.push(`一级指标分值合计应为 100 分，当前为 ${formatScore(total)} 分`);

  groups.forEach((group, groupIndex) => {
    if (!group.name.trim()) errors.push(`第 ${groupIndex + 1} 个一级指标未填写名称`);
    if (score(group.maxScore) <= 0) errors.push(`“${group.name || `第 ${groupIndex + 1} 个一级指标`}”的分值必须大于 0`);
    if (!group.children.length) return;
    const childrenTotal = group.children.reduce((sum, child) => sum + score(child.maxScore), 0);
    if (Math.abs(childrenTotal - score(group.maxScore)) > 0.001) {
      errors.push(`“${group.name || `第 ${groupIndex + 1} 个一级指标`}”的二级指标分值合计应为 ${formatScore(score(group.maxScore))} 分，当前为 ${formatScore(childrenTotal)} 分`);
    }
    group.children.forEach((child, childIndex) => {
      if (!child.name.trim()) errors.push(`“${group.name || `第 ${groupIndex + 1} 个一级指标`}”的第 ${childIndex + 1} 个二级指标未填写名称`);
      if (score(child.maxScore) <= 0) errors.push(`“${child.name || `第 ${childIndex + 1} 个二级指标`}”的分值必须大于 0`);
    });
  });
  return errors;
}

export function buildIndicatorNodes(groups: IndicatorGroupDraft[]): IndicatorNodeInput[] {
  const nodes: IndicatorNodeInput[] = [{ nodeCode: "R", parentCode: null, name: "年度考核", description: "", scoringRule: "", maxScore: 100, sortOrder: 0 }];
  groups.forEach((group, groupIndex) => {
    const groupCode = `L${groupIndex + 1}`;
    nodes.push({
      nodeCode: groupCode, parentCode: "R", name: group.name.trim(), description: group.description.trim(), scoringRule: group.scoringRule.trim(), maxScore: score(group.maxScore), sortOrder: groupIndex + 1,
    });
    group.children.forEach((child, childIndex) => {
      nodes.push({
        nodeCode: `${groupCode}-${childIndex + 1}`, parentCode: groupCode, name: child.name.trim(), description: child.description.trim(), scoringRule: child.scoringRule.trim(), maxScore: score(child.maxScore), sortOrder: (groupIndex + 1) * 100 + childIndex + 1,
      });
    });
  });
  return nodes;
}
