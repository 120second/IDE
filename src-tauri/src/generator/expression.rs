use super::model::{ArithmeticOperator, ValueExpression};

/// Unknown variables stay unknown during validation. Runtime callers supply exact values.
pub(super) fn evaluate(
    expression: &ValueExpression,
    lookup: &impl Fn(&str) -> Result<Option<i64>, String>,
) -> Result<Option<i64>, String> {
    evaluate_at(expression, lookup, 0)
}

fn evaluate_at(
    expression: &ValueExpression,
    lookup: &impl Fn(&str) -> Result<Option<i64>, String>,
    depth: usize,
) -> Result<Option<i64>, String> {
    if depth > 32 {
        return Err("表达式过于复杂，请简化。".into());
    }
    let overflow = || "计算结果超出了 int64 范围。".to_owned();
    match expression {
        ValueExpression::Constant { value } => value
            .trim()
            .parse::<i64>()
            .map(Some)
            .map_err(|_| "请填写整数或有效的算术表达式。".into()),
        ValueExpression::Variable { name, offset } => lookup(name)?
            .map(|value| value.checked_add(*offset).ok_or_else(overflow))
            .transpose(),
        ValueExpression::Arithmetic {
            operator,
            left,
            right,
        } => {
            let left = evaluate_at(left, lookup, depth + 1)?;
            let right = evaluate_at(right, lookup, depth + 1)?;
            if matches!(
                operator,
                ArithmeticOperator::Divide | ArithmeticOperator::Remainder
            ) && right == Some(0)
            {
                return Err("除数不能为 0。".into());
            }
            let (Some(left), Some(right)) = (left, right) else {
                return Ok(None);
            };
            let result = match operator {
                ArithmeticOperator::Add => left.checked_add(right),
                ArithmeticOperator::Subtract => left.checked_sub(right),
                ArithmeticOperator::Multiply => left.checked_mul(right),
                ArithmeticOperator::Divide => left.checked_div(right),
                ArithmeticOperator::Remainder => {
                    if right == -1 {
                        Some(0)
                    } else {
                        left.checked_rem(right)
                    }
                }
            };
            result.map(Some).ok_or_else(overflow)
        }
    }
}

pub(super) fn constant_value(expression: &ValueExpression) -> Option<i64> {
    evaluate(expression, &|_| Ok(None)).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expression(operator: &str, left: &str, right: serde_json::Value) -> ValueExpression {
        serde_json::from_value(
            serde_json::json!({"type":"arithmetic", "operator": operator,
            "left":{"type":"variable","name":left,"offset":0}, "right":right}),
        )
        .unwrap()
    }

    #[test]
    fn arithmetic_checks_runtime_overflow_zero_divisors_and_unknown_values() {
        let triple = expression("*", "n", serde_json::json!({"type":"constant","value":"3"}));
        assert_eq!(evaluate(&triple, &|_| Ok(Some(7))).unwrap(), Some(21));
        assert_eq!(evaluate(&triple, &|_| Ok(None)).unwrap(), None);
        assert!(evaluate(&triple, &|_| Ok(Some(i64::MAX)))
            .unwrap_err()
            .contains("int64"));
        for op in ["/", "%"] {
            let zero = expression(op, "n", serde_json::json!({"type":"constant","value":"0"}));
            assert!(evaluate(&zero, &|_| Ok(None)).unwrap_err().contains("除数"));
            let dynamic = expression(
                op,
                "n",
                serde_json::json!({"type":"variable","name":"m","offset":0}),
            );
            assert!(
                evaluate(&dynamic, &|name| Ok(Some(if name == "n" { 7 } else { 0 })))
                    .unwrap_err()
                    .contains("除数")
            );
        }
        let division = expression("/", "n", serde_json::json!({"type":"constant","value":"2"}));
        assert_eq!(evaluate(&division, &|_| Ok(Some(-7))).unwrap(), Some(-3));
        let remainder = expression(
            "%",
            "n",
            serde_json::json!({"type":"constant","value":"-1"}),
        );
        assert_eq!(
            evaluate(&remainder, &|_| Ok(Some(i64::MIN))).unwrap(),
            Some(0)
        );
    }
}
