export type GeneratorStrategy =
  | "random"
  | "minimum"
  | "maximum"
  | "small"
  | "large"
  | "allSame"
  | "highDuplicate"
  | "ascending"
  | "descending"
  | "extreme"
  | "mixed";

export type TreeShape = "random" | "chain" | "star" | "balanced" | "broom" | "mixed";

export interface GeneratorDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface GeneratorValidation {
  valid: boolean;
  diagnostic?: GeneratorDiagnostic;
}

export interface GenerateRequest {
  dsl: string;
  strategy: GeneratorStrategy;
  treeShape: TreeShape;
  seed: string;
  count: number;
}

export interface GeneratedCase {
  seed: string;
  input: string;
  sizeBytes: number;
  generationTimeMicros: number;
}

export interface GenerateResult {
  cases: GeneratedCase[];
  diagnostic?: GeneratorDiagnostic;
}

export type ValueExpression =
  | { type: "constant"; value: string }
  | { type: "variable"; name: string; offset: number };

export interface VisualRange {
  minimum: ValueExpression;
  maximum: ValueExpression;
}

export type VisualAlphabet = "binary" | "lowercase";
export type VisualGraphKind = "simpleUndirected" | "connectedUndirected" | "dag";

export type VisualField =
  | {
      type: "integer";
      id: string;
      name: string;
      minimum: ValueExpression;
      maximum: ValueExpression;
    }
  | {
      type: "array";
      id: string;
      name: string;
      length: ValueExpression;
      minimum: ValueExpression;
      maximum: ValueExpression;
      strategy?: GeneratorStrategy;
    }
  | {
      type: "string";
      id: string;
      name: string;
      length: ValueExpression;
      alphabet: VisualAlphabet;
    }
  | {
      type: "permutation";
      id: string;
      name: string;
      length: ValueExpression;
    };

export type VisualNode =
  | { type: "line"; id: string; fields: VisualField[] }
  | { type: "repeat"; id: string; count: ValueExpression; children: VisualNode[] }
  | {
      type: "tree";
      id: string;
      nodes: ValueExpression;
      indexBase: 0 | 1;
      shape?: TreeShape;
      weight?: VisualRange;
    }
  | {
      type: "graph";
      id: string;
      nodes: ValueExpression;
      edges: ValueExpression;
      indexBase: 0 | 1;
      kind: VisualGraphKind;
    }
  | {
      type: "matrix";
      id: string;
      name: string;
      rows: ValueExpression;
      columns: ValueExpression;
      minimum: ValueExpression;
      maximum: ValueExpression;
      strategy?: GeneratorStrategy;
    };

export interface VisualGeneratorProfile {
  version: 1;
  nodes: VisualNode[];
  strategy: GeneratorStrategy;
  treeShape: TreeShape;
  seed: string;
}

export interface VisualDiagnostic {
  nodeId: string;
  fieldId?: string;
  message: string;
}

export interface VisualValidationResult {
  valid: boolean;
  diagnostics: VisualDiagnostic[];
}

export interface VisualGenerateRequest {
  profile: VisualGeneratorProfile;
  count: number;
}

export interface VisualGenerateResult {
  cases: GeneratedCase[];
  diagnostics: VisualDiagnostic[];
}
