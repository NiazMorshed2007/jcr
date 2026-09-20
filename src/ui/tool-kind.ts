export const isSkillCall = (tool: string): boolean => {
  const normalized = tool.toLowerCase();
  return (
    normalized === "skill" ||
    normalized.includes("load_skill") ||
    normalized.includes("skill_loader")
  );
};

export const isResolverCall = (tool: string): boolean =>
  tool.toLowerCase().includes("resolve_capabilities");

export const countSkillCalls = (toolCalls: string[]): number =>
  toolCalls.filter(isSkillCall).length;
