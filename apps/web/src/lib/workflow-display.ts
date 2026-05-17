type Translator = (key: string) => string;

const DEFAULT_REASON_KEY_BY_TEXT: Record<string, string> = {
  工作项已超过截止时间: "OVERDUE",
  工作项处于阻塞状态: "BLOCKED",
  工作项处于待确认状态: "PENDING_CONFIRM",
  "Bug 处于待回归状态": "PENDING_REGRESSION",
  工作项状态长时间未变化: "STALE",
};

export function translateWorkflowStateName(
  t: Translator,
  state: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.states",
    state.code,
    state.name,
  );
}

export function translateWorkflowActionName(
  t: Translator,
  action: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.actions",
    action.code,
    action.name,
  );
}

export function translateWorkflowDefinitionName(
  t: Translator,
  workflow: { code?: string; name: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.definitions",
    workflow.code,
    workflow.name,
    "name",
  );
}

export function translateWorkflowDefinitionDescription(
  t: Translator,
  workflow: { code?: string; description?: string | null },
): string | undefined {
  if (!workflow.description) {
    return undefined;
  }

  return translateByStableCode(
    t,
    "common.workflowDefaults.definitions",
    workflow.code,
    workflow.description,
    "description",
  );
}

export function translateWorkflowFieldLabel(
  t: Translator,
  field: { key?: string; label: string },
): string {
  return translateByStableCode(
    t,
    "common.workflowDefaults.fields",
    field.key,
    field.label,
  );
}

export function translateWorkflowSelectOption(
  t: Translator,
  field: { key?: string },
  option: string,
): string {
  const normalized = option.trim();
  if (!normalized) {
    return option;
  }

  const fieldKey = field.key?.trim();
  if (fieldKey) {
    const fieldOption = translateOptional(
      t,
      `common.workflowDefaults.fieldOptions.${fieldKey}.${normalized}`,
    );
    if (fieldOption) {
      return fieldOption;
    }
  }

  const stateName = translateByStableCode(
    t,
    "common.workflowDefaults.states",
    normalized,
    normalized,
  );
  if (stateName !== normalized) {
    return stateName;
  }

  const actionName = translateByStableCode(
    t,
    "common.workflowDefaults.actions",
    normalized,
    normalized,
  );
  if (actionName !== normalized) {
    return actionName;
  }

  const genericOption = translateOptional(
    t,
    `common.workflowDefaults.optionValues.${normalized}`,
  );
  if (genericOption) {
    return genericOption;
  }

  return humanizeStableOption(normalized) ?? option;
}

export function translateExceptionReason(
  t: Translator,
  reason: string,
): string {
  const code = reason.trim().toUpperCase();
  if (/^[A-Z][A-Z0-9_]*$/u.test(code)) {
    return translateByStableCode(t, "common.exceptionReasons", code, reason);
  }

  const knownCode = DEFAULT_REASON_KEY_BY_TEXT[reason.trim()];
  if (knownCode) {
    return translateByStableCode(
      t,
      "common.exceptionReasons",
      knownCode,
      reason,
    );
  }

  return reason;
}

function translateByStableCode(
  t: Translator,
  namespace: string,
  code: string | undefined,
  fallback: string,
  property?: string,
): string {
  const normalized = code?.trim();
  if (!normalized) {
    return fallback;
  }

  const key = property
    ? `${namespace}.${normalized}.${property}`
    : `${namespace}.${normalized}`;
  return translateOptional(t, key) ?? fallback;
}

function translateOptional(t: Translator, key: string): string | undefined {
  try {
    const translated = t(key);
    return translated === key ? undefined : translated;
  } catch {
    return undefined;
  }
}

function humanizeStableOption(option: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(option)) {
    return undefined;
  }

  const words = option
    .split(/[_-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return undefined;
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
