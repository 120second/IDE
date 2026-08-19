use std::collections::HashSet;

use super::model::{
    ValueExpression, VisualDiagnostic, VisualField, VisualGeneratorProfile, VisualNode,
    VisualValidationResult,
};

const PROFILE_VERSION: u32 = 1;
const MAX_VISUAL_NODES: usize = 500;
const MAX_VISUAL_NESTING: usize = 4;

pub fn validate_visual(profile: &VisualGeneratorProfile) -> VisualValidationResult {
    let mut diagnostics = Vec::new();
    if profile.version != PROFILE_VERSION {
        diagnostics.push(VisualDiagnostic::node(
            "profile",
            format!(
                "不支持规则版本 {}，当前版本为 {PROFILE_VERSION}。",
                profile.version
            ),
        ));
    }
    if profile.seed.trim().parse::<u64>().is_err() {
        diagnostics.push(VisualDiagnostic::node(
            "profile",
            "种子必须是 uint64 十进制整数。",
        ));
    }
    if profile.nodes.is_empty() {
        diagnostics.push(VisualDiagnostic::node(
            "profile",
            "请至少添加一条输入规则。",
        ));
    }
    let mut count = 0usize;
    let mut scope = HashSet::new();
    validate_nodes(&profile.nodes, &mut scope, 0, &mut count, &mut diagnostics);
    if count > MAX_VISUAL_NODES {
        diagnostics.push(VisualDiagnostic::node(
            "profile",
            format!("一份规则最多包含 {MAX_VISUAL_NODES} 个节点。"),
        ));
    }
    VisualValidationResult {
        valid: diagnostics.is_empty(),
        diagnostics,
    }
}

fn validate_nodes(
    nodes: &[VisualNode],
    scope: &mut HashSet<String>,
    depth: usize,
    count: &mut usize,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    for node in nodes {
        *count = count.saturating_add(1);
        match node {
            VisualNode::Line { id, fields } => {
                if fields.is_empty() {
                    diagnostics.push(VisualDiagnostic::node(id, "一行中至少需要一个字段。"));
                    continue;
                }
                if fields.len() > 1
                    && fields
                        .iter()
                        .any(|field| matches!(field, VisualField::Array { .. }))
                {
                    diagnostics.push(VisualDiagnostic::node(id, "数组当前必须单独占一行。"));
                }
                for field in fields {
                    *count = count.saturating_add(1);
                    validate_field(id, field, scope, diagnostics);
                }
            }
            VisualNode::Repeat {
                id,
                count: repeat_count,
                children,
            } => {
                validate_expression(id, None, "重复次数", repeat_count, scope, diagnostics);
                validate_static_nonnegative(id, None, "重复次数", repeat_count, diagnostics);
                if children.is_empty() {
                    diagnostics.push(VisualDiagnostic::node(id, "重复块中至少需要一条规则。"));
                }
                if depth >= MAX_VISUAL_NESTING {
                    diagnostics.push(VisualDiagnostic::node(
                        id,
                        format!("重复块最多嵌套 {MAX_VISUAL_NESTING} 层。"),
                    ));
                } else {
                    let mut child_scope = scope.clone();
                    validate_nodes(children, &mut child_scope, depth + 1, count, diagnostics);
                }
            }
            VisualNode::Tree {
                id,
                nodes,
                index_base,
                weight,
                ..
            } => {
                validate_expression(id, None, "节点数", nodes, scope, diagnostics);
                validate_static_positive(id, None, "节点数", nodes, diagnostics);
                validate_index_base(id, *index_base, diagnostics);
                if let Some(weight) = weight {
                    validate_expression(id, None, "权值下界", &weight.minimum, scope, diagnostics);
                    validate_expression(id, None, "权值上界", &weight.maximum, scope, diagnostics);
                }
            }
            VisualNode::Graph {
                id,
                nodes,
                edges,
                index_base,
                ..
            } => {
                validate_expression(id, None, "节点数", nodes, scope, diagnostics);
                validate_expression(id, None, "边数", edges, scope, diagnostics);
                validate_static_nonnegative(id, None, "节点数", nodes, diagnostics);
                validate_static_nonnegative(id, None, "边数", edges, diagnostics);
                validate_index_base(id, *index_base, diagnostics);
            }
            VisualNode::Matrix {
                id,
                name,
                rows,
                columns,
                minimum,
                maximum,
                ..
            } => {
                validate_name(id, None, name, diagnostics);
                validate_expression(id, None, "矩阵行数", rows, scope, diagnostics);
                validate_expression(id, None, "矩阵列数", columns, scope, diagnostics);
                validate_expression(id, None, "元素下界", minimum, scope, diagnostics);
                validate_expression(id, None, "元素上界", maximum, scope, diagnostics);
                validate_static_nonnegative(id, None, "矩阵行数", rows, diagnostics);
                validate_static_nonnegative(id, None, "矩阵列数", columns, diagnostics);
            }
        }
    }
}

fn validate_field(
    node_id: &str,
    field: &VisualField,
    scope: &mut HashSet<String>,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    match field {
        VisualField::Integer {
            id,
            name,
            minimum,
            maximum,
        } => {
            validate_name(node_id, Some(id), name, diagnostics);
            validate_expression(node_id, Some(id), "下界", minimum, scope, diagnostics);
            validate_expression(node_id, Some(id), "上界", maximum, scope, diagnostics);
            if valid_name(name) && !scope.insert(name.clone()) {
                diagnostics.push(VisualDiagnostic::field(
                    node_id,
                    id,
                    format!("整数变量“{name}”已经定义。"),
                ));
            }
        }
        VisualField::Array {
            id,
            name,
            length,
            minimum,
            maximum,
            ..
        } => {
            validate_name(node_id, Some(id), name, diagnostics);
            validate_expression(node_id, Some(id), "数组长度", length, scope, diagnostics);
            validate_expression(node_id, Some(id), "元素下界", minimum, scope, diagnostics);
            validate_expression(node_id, Some(id), "元素上界", maximum, scope, diagnostics);
            validate_static_nonnegative(node_id, Some(id), "数组长度", length, diagnostics);
        }
        VisualField::String {
            id, name, length, ..
        }
        | VisualField::Permutation { id, name, length } => {
            validate_name(node_id, Some(id), name, diagnostics);
            validate_expression(node_id, Some(id), "长度", length, scope, diagnostics);
            validate_static_nonnegative(node_id, Some(id), "长度", length, diagnostics);
        }
    }
}

fn validate_expression(
    node_id: &str,
    field_id: Option<&String>,
    label: &str,
    expression: &ValueExpression,
    scope: &HashSet<String>,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    let message = match expression {
        ValueExpression::Constant { value } => value
            .trim()
            .parse::<i64>()
            .err()
            .map(|_| format!("{label}必须是 int64 整数。")),
        ValueExpression::Variable { name, .. } if !scope.contains(name) => {
            Some(format!("{label}引用的变量“{name}”在当前作用域中不存在。"))
        }
        _ => None,
    };
    if let Some(message) = message {
        push_diagnostic(node_id, field_id, message, diagnostics);
    }
}

fn validate_static_nonnegative(
    node_id: &str,
    field_id: Option<&String>,
    label: &str,
    expression: &ValueExpression,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    if let ValueExpression::Constant { value } = expression {
        if value.trim().parse::<i64>().is_ok_and(|value| value < 0) {
            push_diagnostic(
                node_id,
                field_id,
                format!("{label}不能为负数。"),
                diagnostics,
            );
        }
    }
}

fn validate_static_positive(
    node_id: &str,
    field_id: Option<&String>,
    label: &str,
    expression: &ValueExpression,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    if let ValueExpression::Constant { value } = expression {
        if value.trim().parse::<i64>().is_ok_and(|value| value <= 0) {
            push_diagnostic(
                node_id,
                field_id,
                format!("{label}必须大于 0。"),
                diagnostics,
            );
        }
    }
}

fn validate_name(
    node_id: &str,
    field_id: Option<&String>,
    name: &str,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    if !valid_name(name) {
        push_diagnostic(
            node_id,
            field_id,
            "名称只能包含字母、数字和下划线，且不能以数字开头。",
            diagnostics,
        );
    }
}

fn validate_index_base(id: &str, index_base: u8, diagnostics: &mut Vec<VisualDiagnostic>) {
    if index_base > 1 {
        diagnostics.push(VisualDiagnostic::node(id, "编号起点只能是 0 或 1。"));
    }
}

fn valid_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn push_diagnostic(
    node_id: &str,
    field_id: Option<&String>,
    message: impl Into<String>,
    diagnostics: &mut Vec<VisualDiagnostic>,
) {
    diagnostics.push(match field_id {
        Some(field_id) => VisualDiagnostic::field(node_id, field_id, message),
        None => VisualDiagnostic::node(node_id, message),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generator::{GeneratorStrategy, TreeShape, VisualRange};

    fn constant(value: i64) -> ValueExpression {
        ValueExpression::Constant {
            value: value.to_string(),
        }
    }

    fn variable(name: &str) -> ValueExpression {
        ValueExpression::Variable {
            name: name.to_owned(),
            offset: 0,
        }
    }

    #[test]
    fn profile_round_trips_through_json() {
        let profile = VisualGeneratorProfile {
            version: 1,
            strategy: GeneratorStrategy::Mixed,
            tree_shape: TreeShape::Balanced,
            seed: u64::MAX.to_string(),
            nodes: vec![VisualNode::Tree {
                id: "tree".into(),
                nodes: constant(10),
                index_base: 1,
                shape: None,
                weight: Some(VisualRange {
                    minimum: constant(-5),
                    maximum: constant(5),
                }),
            }],
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert_eq!(
            serde_json::from_str::<VisualGeneratorProfile>(&json).unwrap(),
            profile
        );
    }

    #[test]
    fn repeat_variables_do_not_escape_their_scope() {
        let profile = VisualGeneratorProfile {
            version: 1,
            strategy: GeneratorStrategy::Random,
            tree_shape: TreeShape::Random,
            seed: "1".into(),
            nodes: vec![
                VisualNode::Repeat {
                    id: "repeat".into(),
                    count: constant(1),
                    children: vec![VisualNode::Line {
                        id: "inner-line".into(),
                        fields: vec![VisualField::Integer {
                            id: "inner".into(),
                            name: "n".into(),
                            minimum: constant(1),
                            maximum: constant(10),
                        }],
                    }],
                },
                VisualNode::Tree {
                    id: "tree".into(),
                    nodes: variable("n"),
                    index_base: 1,
                    shape: None,
                    weight: None,
                },
            ],
        };
        let result = validate_visual(&profile);
        assert!(!result.valid);
        assert!(result.diagnostics.iter().any(|item| item.node_id == "tree"));
    }
}
