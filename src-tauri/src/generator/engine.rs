use std::{
    collections::{HashMap, HashSet},
    time::Instant,
};

use super::{
    model::{
        Alphabet, Expression, ExpressionValue, GenerateRequest, GenerateResult, GeneratedCase,
        GeneratorDiagnostic, GeneratorStrategy, GraphKind, Program, Statement, StatementKind,
        TreeShape, ValidationResult, ValueExpression, VisualAlphabet, VisualDiagnostic,
        VisualField, VisualGenerateRequest, VisualGenerateResult, VisualGraphKind, VisualNode,
        VisualRange,
    },
    parser, visual,
};

const MAX_CASES: u32 = 100;
const MAX_ITEMS: usize = 1_000_000;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_BATCH_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

pub fn validate(dsl: &str) -> ValidationResult {
    match parser::parse(dsl) {
        Ok(_) => ValidationResult {
            valid: true,
            diagnostic: None,
        },
        Err(diagnostic) => ValidationResult {
            valid: false,
            diagnostic: Some(diagnostic),
        },
    }
}

pub fn generate(request: &GenerateRequest) -> GenerateResult {
    let program = match parser::parse(&request.dsl) {
        Ok(program) => program,
        Err(diagnostic) => return failure(diagnostic),
    };
    if request.count == 0 || request.count > MAX_CASES {
        return failure(GeneratorDiagnostic::new(
            1,
            1,
            format!("每次生成数量必须在 1 到 {MAX_CASES} 之间。"),
        ));
    }
    let seed = match request.seed.trim().parse::<u64>() {
        Ok(seed) => seed,
        Err(_) => {
            return failure(GeneratorDiagnostic::new(
                1,
                1,
                "种子必须是 0 到 18446744073709551615 之间的十进制整数。",
            ));
        }
    };

    let mut seed_stream = SplitMix64::new(seed);
    let mut cases = Vec::with_capacity(request.count as usize);
    let mut batch_output_bytes = 0usize;
    for index in 0..request.count {
        let case_seed = if index == 0 {
            seed
        } else {
            seed_stream.next_u64()
        };
        let engine = Engine::new(case_seed, request.strategy, request.tree_shape);
        let started = Instant::now();
        match engine.run(&program) {
            Ok(input) => {
                batch_output_bytes = batch_output_bytes.saturating_add(input.len());
                if batch_output_bytes > MAX_BATCH_OUTPUT_BYTES {
                    return failure(GeneratorDiagnostic::new(
                        1,
                        1,
                        "本次批量生成结果超过 64 MiB，请减少数量或缩小数据规模。",
                    ));
                }
                cases.push(GeneratedCase {
                    seed: case_seed.to_string(),
                    size_bytes: input.len(),
                    generation_time_micros: started.elapsed().as_micros() as u64,
                    input,
                });
            }
            Err(diagnostic) => return failure(diagnostic),
        }
    }
    GenerateResult {
        cases,
        diagnostic: None,
    }
}

pub fn generate_visual(request: &VisualGenerateRequest) -> VisualGenerateResult {
    let validation = visual::validate_visual(&request.profile);
    if !validation.valid {
        return VisualGenerateResult {
            cases: Vec::new(),
            diagnostics: validation.diagnostics,
        };
    }
    if request.count == 0 || request.count > MAX_CASES {
        return visual_failure(VisualDiagnostic::node(
            "profile",
            format!("每次生成数量必须在 1 到 {MAX_CASES} 之间。"),
        ));
    }
    let seed = match request.profile.seed.trim().parse::<u64>() {
        Ok(seed) => seed,
        Err(_) => {
            return visual_failure(VisualDiagnostic::node(
                "profile",
                "种子必须是 uint64 十进制整数。",
            ));
        }
    };
    let mut seed_stream = SplitMix64::new(seed);
    let mut cases = Vec::with_capacity(request.count as usize);
    let mut batch_output_bytes = 0usize;
    for index in 0..request.count {
        let case_seed = if index == 0 {
            seed
        } else {
            seed_stream.next_u64()
        };
        let engine = Engine::new(
            case_seed,
            request.profile.strategy,
            request.profile.tree_shape,
        );
        let started = Instant::now();
        match engine.run_visual(&request.profile.nodes) {
            Ok(input) => {
                batch_output_bytes = batch_output_bytes.saturating_add(input.len());
                if batch_output_bytes > MAX_BATCH_OUTPUT_BYTES {
                    return visual_failure(VisualDiagnostic::node(
                        "profile",
                        "本次批量生成结果超过 64 MiB，请减少数量或缩小数据规模。",
                    ));
                }
                cases.push(GeneratedCase {
                    seed: case_seed.to_string(),
                    size_bytes: input.len(),
                    generation_time_micros: started.elapsed().as_micros() as u64,
                    input,
                });
            }
            Err(diagnostic) => return visual_failure(diagnostic),
        }
    }
    VisualGenerateResult {
        cases,
        diagnostics: Vec::new(),
    }
}

fn visual_failure(diagnostic: VisualDiagnostic) -> VisualGenerateResult {
    VisualGenerateResult {
        cases: Vec::new(),
        diagnostics: vec![diagnostic],
    }
}

fn failure(diagnostic: GeneratorDiagnostic) -> GenerateResult {
    GenerateResult {
        cases: Vec::new(),
        diagnostic: Some(diagnostic),
    }
}

struct Engine {
    variables: HashMap<String, i64>,
    random: SplitMix64,
    strategy: GeneratorStrategy,
    tree_shape: TreeShape,
    output: Output,
    item_count: usize,
}

impl Engine {
    fn new(seed: u64, strategy: GeneratorStrategy, tree_shape: TreeShape) -> Self {
        Self {
            variables: HashMap::new(),
            random: SplitMix64::new(seed),
            strategy,
            tree_shape,
            output: Output::default(),
            item_count: 0,
        }
    }

    fn run(mut self, program: &Program) -> Result<String, GeneratorDiagnostic> {
        self.execute_block(&program.statements)?;
        Ok(self.output.finish())
    }

    fn run_visual(mut self, nodes: &[VisualNode]) -> Result<String, VisualDiagnostic> {
        self.execute_visual_block(nodes)?;
        Ok(self.output.finish())
    }

    fn execute_visual_block(&mut self, nodes: &[VisualNode]) -> Result<(), VisualDiagnostic> {
        for node in nodes {
            self.execute_visual(node)?;
        }
        Ok(())
    }

    fn execute_visual(&mut self, node: &VisualNode) -> Result<(), VisualDiagnostic> {
        match node {
            VisualNode::Line { id, fields } => {
                let mut parts = Vec::with_capacity(fields.len());
                for field in fields {
                    parts.push(self.execute_visual_field(id, field)?);
                }
                self.output.push_visual_line(parts.join(" "), id)?;
            }
            VisualNode::Repeat {
                id,
                count,
                children,
            } => {
                let count = self.visual_size(count, id, None, "重复次数")?;
                self.reserve_visual_items(count, id, None)?;
                let outer_variables = self.variables.clone();
                for _ in 0..count {
                    self.execute_visual_block(children)?;
                }
                self.variables = outer_variables;
            }
            VisualNode::Tree {
                id,
                nodes,
                index_base,
                shape,
                weight,
            } => {
                let nodes = self.visual_size(nodes, id, None, "树的节点数")?;
                if nodes == 0 {
                    return Err(VisualDiagnostic::node(id, "树的节点数至少为 1。"));
                }
                self.reserve_visual_items(nodes.saturating_sub(1), id, None)?;
                let weight_bounds = weight
                    .as_ref()
                    .map(|range| self.visual_range(range, id, None))
                    .transpose()?;
                let edges = self.tree_edges_using(nodes, shape.unwrap_or(self.tree_shape));
                for (index, (left, right)) in edges.into_iter().enumerate() {
                    let left = shift_index(left, *index_base);
                    let right = shift_index(right, *index_base);
                    let line = if let Some((minimum, maximum)) = weight_bounds {
                        let weight = self.value(minimum, maximum, index);
                        format!("{left} {right} {weight}")
                    } else {
                        format!("{left} {right}")
                    };
                    self.output.push_visual_line(line, id)?;
                }
            }
            VisualNode::Graph {
                id,
                nodes,
                edges,
                index_base,
                kind,
            } => {
                let nodes = self.visual_size(nodes, id, None, "图的节点数")?;
                let edge_count = self.visual_size(edges, id, None, "图的边数")?;
                self.reserve_visual_items(edge_count, id, None)?;
                let graph_kind = match kind {
                    VisualGraphKind::SimpleUndirected => GraphKind::Simple,
                    VisualGraphKind::ConnectedUndirected => GraphKind::Connected,
                    VisualGraphKind::Dag => GraphKind::Dag,
                };
                let generated = self
                    .graph_edges_raw(nodes, edge_count, graph_kind)
                    .map_err(|message| VisualDiagnostic::node(id, message))?;
                for (left, right) in generated {
                    self.output.push_visual_line(
                        format!(
                            "{} {}",
                            shift_index(left, *index_base),
                            shift_index(right, *index_base)
                        ),
                        id,
                    )?;
                }
            }
            VisualNode::Matrix {
                id,
                rows,
                columns,
                minimum,
                maximum,
                strategy,
                ..
            } => {
                let rows = self.visual_size(rows, id, None, "矩阵行数")?;
                let columns = self.visual_size(columns, id, None, "矩阵列数")?;
                let items = rows
                    .checked_mul(columns)
                    .ok_or_else(|| VisualDiagnostic::node(id, "矩阵规模过大，无法生成。"))?;
                self.reserve_visual_items(items, id, None)?;
                let (minimum, maximum) = self.visual_bounds(minimum, maximum, id, None)?;
                for _ in 0..rows {
                    let values = self.values_using(
                        columns,
                        minimum,
                        maximum,
                        strategy.unwrap_or(self.strategy),
                    );
                    self.output.push_visual_line(join_numbers(&values), id)?;
                }
            }
        }
        Ok(())
    }

    fn execute_visual_field(
        &mut self,
        node_id: &str,
        field: &VisualField,
    ) -> Result<String, VisualDiagnostic> {
        match field {
            VisualField::Integer {
                id,
                name,
                minimum,
                maximum,
            } => {
                let (minimum, maximum) = self.visual_bounds(minimum, maximum, node_id, Some(id))?;
                let value = self.value(minimum, maximum, 0);
                self.variables.insert(name.clone(), value);
                Ok(value.to_string())
            }
            VisualField::Array {
                id,
                length,
                minimum,
                maximum,
                strategy,
                ..
            } => {
                let length = self.visual_size(length, node_id, Some(id), "数组长度")?;
                self.reserve_visual_items(length, node_id, Some(id))?;
                let (minimum, maximum) = self.visual_bounds(minimum, maximum, node_id, Some(id))?;
                Ok(join_numbers(&self.values_using(
                    length,
                    minimum,
                    maximum,
                    strategy.unwrap_or(self.strategy),
                )))
            }
            VisualField::String {
                id,
                length,
                alphabet,
                ..
            } => {
                let length = self.visual_size(length, node_id, Some(id), "字符串长度")?;
                self.reserve_visual_items(length, node_id, Some(id))?;
                Ok(self.visual_string(length, *alphabet))
            }
            VisualField::Permutation { id, length, .. } => {
                let length = self.visual_size(length, node_id, Some(id), "排列长度")?;
                self.reserve_visual_items(length, node_id, Some(id))?;
                let mut values: Vec<i64> = (1..=length).map(|value| value as i64).collect();
                match self.effective_strategy() {
                    GeneratorStrategy::Minimum | GeneratorStrategy::Ascending => {}
                    GeneratorStrategy::Maximum | GeneratorStrategy::Descending => values.reverse(),
                    _ => self.random.shuffle(&mut values),
                }
                Ok(join_numbers(&values))
            }
        }
    }

    fn evaluate_visual(
        &self,
        expression: &ValueExpression,
        node_id: &str,
        field_id: Option<&String>,
        label: &str,
    ) -> Result<i64, VisualDiagnostic> {
        let error = |message: String| match field_id {
            Some(field_id) => VisualDiagnostic::field(node_id, field_id, message),
            None => VisualDiagnostic::node(node_id, message),
        };
        match expression {
            ValueExpression::Constant { value } => value
                .trim()
                .parse::<i64>()
                .map_err(|_| error(format!("{label}必须是 int64 整数。"))),
            ValueExpression::Variable { name, offset } => {
                let value = self.variables.get(name).copied().ok_or_else(|| {
                    error(format!("{label}引用的变量“{name}”在当前作用域中不存在。"))
                })?;
                value
                    .checked_add(*offset)
                    .ok_or_else(|| error(format!("{label}计算结果超出了 int64 范围。")))
            }
        }
    }

    fn visual_bounds(
        &self,
        minimum: &ValueExpression,
        maximum: &ValueExpression,
        node_id: &str,
        field_id: Option<&String>,
    ) -> Result<(i64, i64), VisualDiagnostic> {
        let minimum = self.evaluate_visual(minimum, node_id, field_id, "下界")?;
        let maximum = self.evaluate_visual(maximum, node_id, field_id, "上界")?;
        if minimum > maximum {
            let message = format!("区间下界 {minimum} 不能大于上界 {maximum}。");
            return Err(match field_id {
                Some(field_id) => VisualDiagnostic::field(node_id, field_id, message),
                None => VisualDiagnostic::node(node_id, message),
            });
        }
        Ok((minimum, maximum))
    }

    fn visual_range(
        &self,
        range: &VisualRange,
        node_id: &str,
        field_id: Option<&String>,
    ) -> Result<(i64, i64), VisualDiagnostic> {
        self.visual_bounds(&range.minimum, &range.maximum, node_id, field_id)
    }

    fn visual_size(
        &self,
        expression: &ValueExpression,
        node_id: &str,
        field_id: Option<&String>,
        label: &str,
    ) -> Result<usize, VisualDiagnostic> {
        let value = self.evaluate_visual(expression, node_id, field_id, label)?;
        if value < 0 || value as u128 > MAX_ITEMS as u128 {
            let message = format!("{label}必须在 0 到 {MAX_ITEMS} 之间。");
            return Err(match field_id {
                Some(field_id) => VisualDiagnostic::field(node_id, field_id, message),
                None => VisualDiagnostic::node(node_id, message),
            });
        }
        Ok(value as usize)
    }

    fn reserve_visual_items(
        &mut self,
        amount: usize,
        node_id: &str,
        field_id: Option<&String>,
    ) -> Result<(), VisualDiagnostic> {
        self.item_count = self.item_count.saturating_add(amount);
        if self.item_count > MAX_ITEMS {
            let message = format!("单个测试点最多生成 {MAX_ITEMS} 个数据项。");
            return Err(match field_id {
                Some(field_id) => VisualDiagnostic::field(node_id, field_id, message),
                None => VisualDiagnostic::node(node_id, message),
            });
        }
        Ok(())
    }

    fn execute_block(&mut self, statements: &[Statement]) -> Result<(), GeneratorDiagnostic> {
        for statement in statements {
            self.execute(statement)?;
        }
        Ok(())
    }

    fn execute(&mut self, statement: &Statement) -> Result<(), GeneratorDiagnostic> {
        match &statement.kind {
            StatementKind::Integer { minimum, maximum } => {
                let (minimum, maximum) = self.bounds(minimum, maximum)?;
                let value = self.value(minimum, maximum, 0);
                self.output.push_line(value.to_string(), statement)?;
                if let Some(name) = &statement.name {
                    self.variables.insert(name.clone(), value);
                }
            }
            StatementKind::Array {
                length,
                minimum,
                maximum,
                unique,
            } => {
                let length = self.size(length, "数组长度")?;
                self.reserve_items(length, statement)?;
                let (minimum, maximum) = self.bounds(minimum, maximum)?;
                let values = if *unique {
                    self.unique_values(length, minimum, maximum, statement)?
                } else {
                    self.values(length, minimum, maximum)
                };
                self.output.push_line(join_numbers(&values), statement)?;
            }
            StatementKind::Pair {
                first_minimum,
                first_maximum,
                second_minimum,
                second_maximum,
            } => {
                self.reserve_items(2, statement)?;
                let first_bounds = self.bounds(first_minimum, first_maximum)?;
                let second_bounds = self.bounds(second_minimum, second_maximum)?;
                let first = self.value(first_bounds.0, first_bounds.1, 0);
                let second = self.value(second_bounds.0, second_bounds.1, 1);
                self.output
                    .push_line(format!("{first} {second}"), statement)?;
            }
            StatementKind::Matrix {
                rows,
                columns,
                minimum,
                maximum,
            } => {
                let rows = self.size(rows, "矩阵行数")?;
                let columns = self.size(columns, "矩阵列数")?;
                let items = rows
                    .checked_mul(columns)
                    .ok_or_else(|| self.at(statement, "矩阵规模过大，无法生成。"))?;
                self.reserve_items(items, statement)?;
                let (minimum, maximum) = self.bounds(minimum, maximum)?;
                for _ in 0..rows {
                    let values = self.values(columns, minimum, maximum);
                    self.output.push_line(join_numbers(&values), statement)?;
                }
            }
            StatementKind::String { length, alphabet } => {
                let length = self.size(length, "字符串长度")?;
                self.reserve_items(length, statement)?;
                let value = self.string(length, *alphabet);
                self.output.push_line(value, statement)?;
            }
            StatementKind::Permutation { length } => {
                let length = self.size(length, "排列长度")?;
                self.reserve_items(length, statement)?;
                let mut values: Vec<i64> = (1..=length).map(|value| value as i64).collect();
                match self.effective_strategy() {
                    GeneratorStrategy::Minimum | GeneratorStrategy::Ascending => {}
                    GeneratorStrategy::Maximum | GeneratorStrategy::Descending => values.reverse(),
                    _ => self.random.shuffle(&mut values),
                }
                self.output.push_line(join_numbers(&values), statement)?;
            }
            StatementKind::Repeat { count, body } => {
                let count = self.size(count, "repeat 次数")?;
                self.reserve_items(count, statement)?;
                for _ in 0..count {
                    self.execute_block(body)?;
                }
            }
            StatementKind::Tree { nodes, weight } => {
                let nodes = self.size(nodes, "树的节点数")?;
                if nodes == 0 {
                    return Err(self.at(statement, "树的节点数至少为 1。"));
                }
                self.reserve_items(nodes.saturating_sub(1), statement)?;
                let weight_bounds = weight
                    .as_ref()
                    .map(|(minimum, maximum)| self.bounds(minimum, maximum))
                    .transpose()?;
                let edges = self.tree_edges(nodes);
                for (index, (left, right)) in edges.into_iter().enumerate() {
                    let line = if let Some((minimum, maximum)) = weight_bounds {
                        let weight = self.value(minimum, maximum, index);
                        format!("{left} {right} {weight}")
                    } else {
                        format!("{left} {right}")
                    };
                    self.output.push_line(line, statement)?;
                }
            }
            StatementKind::Graph { nodes, edges, kind } => {
                let nodes = self.size(nodes, "图的节点数")?;
                let edges = self.size(edges, "图的边数")?;
                self.reserve_items(edges, statement)?;
                let generated = self.graph_edges(nodes, edges, *kind, statement)?;
                for (left, right) in generated {
                    self.output
                        .push_line(format!("{left} {right}"), statement)?;
                }
            }
        }
        Ok(())
    }

    fn evaluate(&self, expression: &Expression) -> Result<i64, GeneratorDiagnostic> {
        match &expression.value {
            ExpressionValue::Literal(value) => Ok(*value),
            ExpressionValue::Variable(name) => self.variables.get(name).copied().ok_or_else(|| {
                GeneratorDiagnostic::new(
                    expression.line,
                    expression.column,
                    format!("变量“{name}”尚未定义。请先在前面的 int 语句中定义它。"),
                )
            }),
        }
    }

    fn bounds(
        &self,
        minimum: &Expression,
        maximum: &Expression,
    ) -> Result<(i64, i64), GeneratorDiagnostic> {
        let minimum_value = self.evaluate(minimum)?;
        let maximum_value = self.evaluate(maximum)?;
        if minimum_value > maximum_value {
            return Err(GeneratorDiagnostic::new(
                maximum.line,
                maximum.column,
                format!("区间下界 {minimum_value} 不能大于上界 {maximum_value}。"),
            ));
        }
        Ok((minimum_value, maximum_value))
    }

    fn size(&self, expression: &Expression, label: &str) -> Result<usize, GeneratorDiagnostic> {
        let value = self.evaluate(expression)?;
        if value < 0 || value as u128 > MAX_ITEMS as u128 {
            return Err(GeneratorDiagnostic::new(
                expression.line,
                expression.column,
                format!("{label}必须在 0 到 {MAX_ITEMS} 之间。"),
            ));
        }
        Ok(value as usize)
    }

    fn reserve_items(
        &mut self,
        amount: usize,
        statement: &Statement,
    ) -> Result<(), GeneratorDiagnostic> {
        self.item_count = self
            .item_count
            .checked_add(amount)
            .ok_or_else(|| self.at(statement, "生成的数据规模过大。"))?;
        if self.item_count > MAX_ITEMS {
            return Err(self.at(
                statement,
                format!("单个测试点最多生成 {MAX_ITEMS} 个数据项。"),
            ));
        }
        Ok(())
    }

    fn values(&mut self, length: usize, minimum: i64, maximum: i64) -> Vec<i64> {
        self.values_using(length, minimum, maximum, self.strategy)
    }

    fn values_using(
        &mut self,
        length: usize,
        minimum: i64,
        maximum: i64,
        configured_strategy: GeneratorStrategy,
    ) -> Vec<i64> {
        let strategy = self.effective_strategy_using(configured_strategy);
        let mut values = Vec::with_capacity(length);
        if strategy == GeneratorStrategy::AllSame {
            let value = self.random_inclusive(minimum, maximum);
            values.resize(length, value);
            return values;
        }
        for index in 0..length {
            let value = match strategy {
                GeneratorStrategy::HighDuplicate => {
                    let candidates = [minimum, midpoint(minimum, maximum), maximum];
                    candidates[self.random.bounded(3) as usize]
                }
                GeneratorStrategy::Extreme => {
                    if index % 2 == 0 {
                        minimum
                    } else {
                        maximum
                    }
                }
                _ => self.value_with(strategy, minimum, maximum, index),
            };
            values.push(value);
        }
        if strategy == GeneratorStrategy::Ascending {
            values.sort_unstable();
        } else if strategy == GeneratorStrategy::Descending {
            values.sort_unstable_by(|left, right| right.cmp(left));
        }
        values
    }

    fn unique_values(
        &mut self,
        length: usize,
        minimum: i64,
        maximum: i64,
        statement: &Statement,
    ) -> Result<Vec<i64>, GeneratorDiagnostic> {
        let capacity = range_size(minimum, maximum);
        if length as u128 > capacity {
            return Err(self.at(
                statement,
                format!("unique_array 需要 {length} 个不同整数，但区间内只有 {capacity} 个。"),
            ));
        }
        let strategy = self.effective_strategy();
        if strategy == GeneratorStrategy::Minimum {
            return Ok((0..length)
                .map(|offset| add_offset(minimum, offset as u64))
                .collect());
        }
        if strategy == GeneratorStrategy::Maximum {
            return Ok((0..length)
                .map(|offset| subtract_offset(maximum, offset as u64))
                .collect());
        }
        let mut values = Vec::with_capacity(length);
        if capacity <= 2_000_000 && length as u128 * 2 > capacity {
            values.extend((0..capacity).map(|offset| add_offset(minimum, offset as u64)));
            self.random.shuffle(&mut values);
            values.truncate(length);
        } else {
            let mut seen = HashSet::with_capacity(length);
            let retry_limit = length.saturating_mul(16).saturating_add(64);
            for _ in 0..retry_limit {
                if values.len() == length {
                    break;
                }
                let value = self.random_inclusive(minimum, maximum);
                if seen.insert(value) {
                    values.push(value);
                }
            }
            let mut offset = 0u128;
            while values.len() < length {
                let value = add_offset(minimum, offset as u64);
                if seen.insert(value) {
                    values.push(value);
                }
                offset += 1;
            }
        }
        match strategy {
            GeneratorStrategy::Ascending => values.sort_unstable(),
            GeneratorStrategy::Descending => {
                values.sort_unstable_by(|left, right| right.cmp(left));
            }
            _ => {}
        }
        Ok(values)
    }

    fn string(&mut self, length: usize, alphabet: Alphabet) -> String {
        let maximum = match alphabet {
            Alphabet::Binary => 1,
            Alphabet::Lowercase => 25,
        };
        let values = self.values(length, 0, maximum);
        values
            .into_iter()
            .map(|value| match alphabet {
                Alphabet::Binary => {
                    if value == 0 {
                        '0'
                    } else {
                        '1'
                    }
                }
                Alphabet::Lowercase => (b'a' + value as u8) as char,
            })
            .collect()
    }

    fn visual_string(&mut self, length: usize, alphabet: VisualAlphabet) -> String {
        let maximum = match alphabet {
            VisualAlphabet::Binary => 1,
            VisualAlphabet::Lowercase => 25,
        };
        let strategy = self.strategy;
        self.values_using(length, 0, maximum, strategy)
            .into_iter()
            .map(|value| match alphabet {
                VisualAlphabet::Binary => {
                    if value == 0 {
                        '0'
                    } else {
                        '1'
                    }
                }
                VisualAlphabet::Lowercase => (b'a' + value as u8) as char,
            })
            .collect()
    }

    fn tree_edges(&mut self, nodes: usize) -> Vec<(usize, usize)> {
        self.tree_edges_using(nodes, self.tree_shape)
    }

    fn tree_edges_using(
        &mut self,
        nodes: usize,
        configured_shape: TreeShape,
    ) -> Vec<(usize, usize)> {
        let shape = self.effective_tree_shape_using(configured_shape);
        let mut edges = Vec::with_capacity(nodes.saturating_sub(1));
        for node in 2..=nodes {
            let parent = match shape {
                TreeShape::Chain => node - 1,
                TreeShape::Star => 1,
                TreeShape::Balanced => node / 2,
                TreeShape::Broom => {
                    let handle = (nodes / 2).max(1);
                    if node <= handle + 1 {
                        node - 1
                    } else {
                        handle
                    }
                }
                TreeShape::Random | TreeShape::Mixed => {
                    self.random.bounded((node - 1) as u64) as usize + 1
                }
            };
            edges.push((parent, node));
        }
        if matches!(shape, TreeShape::Random | TreeShape::Mixed) {
            self.random.shuffle(&mut edges);
        }
        edges
    }

    fn graph_edges(
        &mut self,
        nodes: usize,
        edge_count: usize,
        kind: GraphKind,
        statement: &Statement,
    ) -> Result<Vec<(usize, usize)>, GeneratorDiagnostic> {
        self.graph_edges_raw(nodes, edge_count, kind)
            .map_err(|message| self.at(statement, message))
    }

    fn graph_edges_raw(
        &mut self,
        nodes: usize,
        edge_count: usize,
        kind: GraphKind,
    ) -> Result<Vec<(usize, usize)>, String> {
        let maximum = (nodes as u128).saturating_mul(nodes.saturating_sub(1) as u128) / 2;
        if edge_count as u128 > maximum {
            return Err(format!("{nodes} 个节点的简单图最多只有 {maximum} 条边。"));
        }
        if kind == GraphKind::Connected && nodes == 0 {
            return Err("连通图的节点数至少为 1。".to_owned());
        }
        if kind == GraphKind::Connected && edge_count < nodes.saturating_sub(1) {
            return Err(format!(
                "{nodes} 个节点的连通图至少需要 {} 条边。",
                nodes - 1
            ));
        }

        let mut edges = Vec::with_capacity(edge_count);
        let mut seen = HashSet::with_capacity(edge_count);
        if kind == GraphKind::Connected {
            for (left, right) in self.tree_edges(nodes) {
                let edge = normalized_edge(left, right);
                seen.insert(edge);
                edges.push(edge);
            }
        }

        let retry_limit = edge_count.saturating_mul(24).saturating_add(128);
        for _ in 0..retry_limit {
            if edges.len() == edge_count || nodes < 2 {
                break;
            }
            let left = self.random.bounded(nodes as u64) as usize + 1;
            let mut right = self.random.bounded((nodes - 1) as u64) as usize + 1;
            if right >= left {
                right += 1;
            }
            let edge = normalized_edge(left, right);
            if seen.insert(edge) {
                edges.push(edge);
            }
        }
        if edges.len() < edge_count {
            'outer: for left in 1..=nodes {
                for right in left + 1..=nodes {
                    let edge = (left, right);
                    if seen.insert(edge) {
                        edges.push(edge);
                        if edges.len() == edge_count {
                            break 'outer;
                        }
                    }
                }
            }
        }
        if kind != GraphKind::Dag {
            self.random.shuffle(&mut edges);
        }
        Ok(edges)
    }

    fn value(&mut self, minimum: i64, maximum: i64, index: usize) -> i64 {
        let strategy = self.effective_strategy();
        self.value_with(strategy, minimum, maximum, index)
    }

    fn value_with(
        &mut self,
        strategy: GeneratorStrategy,
        minimum: i64,
        maximum: i64,
        index: usize,
    ) -> i64 {
        match strategy {
            GeneratorStrategy::Minimum => minimum,
            GeneratorStrategy::Maximum => maximum,
            GeneratorStrategy::Small => {
                let upper = fraction_point(minimum, maximum, 1, 10);
                self.random_inclusive(minimum, upper)
            }
            GeneratorStrategy::Large => {
                let lower = fraction_point(minimum, maximum, 9, 10);
                self.random_inclusive(lower, maximum)
            }
            GeneratorStrategy::Extreme => {
                if index % 2 == 0 {
                    minimum
                } else {
                    maximum
                }
            }
            GeneratorStrategy::AllSame
            | GeneratorStrategy::HighDuplicate
            | GeneratorStrategy::Ascending
            | GeneratorStrategy::Descending
            | GeneratorStrategy::Random
            | GeneratorStrategy::Mixed => self.random_inclusive(minimum, maximum),
        }
    }

    fn random_inclusive(&mut self, minimum: i64, maximum: i64) -> i64 {
        let size = range_size(minimum, maximum);
        let offset = if size == (u64::MAX as u128) + 1 {
            self.random.next_u64()
        } else {
            self.random.bounded(size as u64)
        };
        add_offset(minimum, offset)
    }

    fn effective_strategy(&mut self) -> GeneratorStrategy {
        self.effective_strategy_using(self.strategy)
    }

    fn effective_strategy_using(
        &mut self,
        configured_strategy: GeneratorStrategy,
    ) -> GeneratorStrategy {
        if configured_strategy != GeneratorStrategy::Mixed {
            return configured_strategy;
        }
        const OPTIONS: [GeneratorStrategy; 10] = [
            GeneratorStrategy::Random,
            GeneratorStrategy::Minimum,
            GeneratorStrategy::Maximum,
            GeneratorStrategy::Small,
            GeneratorStrategy::Large,
            GeneratorStrategy::AllSame,
            GeneratorStrategy::HighDuplicate,
            GeneratorStrategy::Ascending,
            GeneratorStrategy::Descending,
            GeneratorStrategy::Extreme,
        ];
        OPTIONS[self.random.bounded(OPTIONS.len() as u64) as usize]
    }

    fn effective_tree_shape_using(&mut self, configured_shape: TreeShape) -> TreeShape {
        if configured_shape != TreeShape::Mixed {
            return configured_shape;
        }
        const OPTIONS: [TreeShape; 5] = [
            TreeShape::Random,
            TreeShape::Chain,
            TreeShape::Star,
            TreeShape::Balanced,
            TreeShape::Broom,
        ];
        OPTIONS[self.random.bounded(OPTIONS.len() as u64) as usize]
    }

    fn at(&self, statement: &Statement, message: impl Into<String>) -> GeneratorDiagnostic {
        GeneratorDiagnostic::new(statement.line, statement.column, message)
    }
}

#[derive(Default)]
struct Output {
    content: String,
}

impl Output {
    fn push_line(
        &mut self,
        line: String,
        statement: &Statement,
    ) -> Result<(), GeneratorDiagnostic> {
        let additional = line.len() + 1;
        if self.content.len().saturating_add(additional) > MAX_OUTPUT_BYTES {
            return Err(GeneratorDiagnostic::new(
                statement.line,
                statement.column,
                "生成结果超过 16 MiB，请缩小数据规模。",
            ));
        }
        self.content.push_str(&line);
        self.content.push('\n');
        Ok(())
    }

    fn push_visual_line(&mut self, line: String, node_id: &str) -> Result<(), VisualDiagnostic> {
        let additional = line.len() + 1;
        if self.content.len().saturating_add(additional) > MAX_OUTPUT_BYTES {
            return Err(VisualDiagnostic::node(
                node_id,
                "生成结果超过 16 MiB，请缩小数据规模。",
            ));
        }
        self.content.push_str(&line);
        self.content.push('\n');
        Ok(())
    }

    fn finish(mut self) -> String {
        if self.content.ends_with('\n') {
            self.content.pop();
        }
        self.content
    }
}

#[derive(Debug, Clone)]
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D049BB133111EB);
        value ^ (value >> 31)
    }

    fn bounded(&mut self, upper: u64) -> u64 {
        if upper <= 1 {
            return 0;
        }
        let threshold = upper.wrapping_neg() % upper;
        loop {
            let value = self.next_u64();
            if value >= threshold {
                return value % upper;
            }
        }
    }

    fn shuffle<T>(&mut self, values: &mut [T]) {
        for index in (1..values.len()).rev() {
            let target = self.bounded((index + 1) as u64) as usize;
            values.swap(index, target);
        }
    }
}

fn range_size(minimum: i64, maximum: i64) -> u128 {
    (maximum as i128 - minimum as i128 + 1) as u128
}

fn add_offset(minimum: i64, offset: u64) -> i64 {
    (minimum as i128 + offset as i128) as i64
}

fn subtract_offset(maximum: i64, offset: u64) -> i64 {
    (maximum as i128 - offset as i128) as i64
}

fn midpoint(minimum: i64, maximum: i64) -> i64 {
    (minimum as i128 + (maximum as i128 - minimum as i128) / 2) as i64
}

fn fraction_point(minimum: i64, maximum: i64, numerator: i128, denominator: i128) -> i64 {
    (minimum as i128 + (maximum as i128 - minimum as i128) * numerator / denominator) as i64
}

fn normalized_edge(left: usize, right: usize) -> (usize, usize) {
    if left < right {
        (left, right)
    } else {
        (right, left)
    }
}

fn shift_index(value: usize, index_base: u8) -> usize {
    if index_base == 0 {
        value - 1
    } else {
        value
    }
}

fn join_numbers(values: &[i64]) -> String {
    values
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generated(dsl: &str, strategy: GeneratorStrategy, shape: TreeShape, seed: u64) -> String {
        let result = generate(&GenerateRequest {
            dsl: dsl.to_owned(),
            strategy,
            tree_shape: shape,
            seed: seed.to_string(),
            count: 1,
        });
        assert!(result.diagnostic.is_none(), "{:?}", result.diagnostic);
        result.cases[0].input.clone()
    }

    fn visual_generated(nodes: Vec<VisualNode>, seed: u64) -> String {
        let result = generate_visual(&VisualGenerateRequest {
            profile: super::super::VisualGeneratorProfile {
                version: 1,
                nodes,
                strategy: GeneratorStrategy::Random,
                tree_shape: TreeShape::Mixed,
                seed: seed.to_string(),
            },
            count: 1,
        });
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        result.cases[0].input.clone()
    }

    fn visual_constant(value: i64) -> ValueExpression {
        ValueExpression::Constant {
            value: value.to_string(),
        }
    }

    fn visual_variable(name: &str) -> ValueExpression {
        ValueExpression::Variable {
            name: name.to_owned(),
            offset: 0,
        }
    }

    #[test]
    fn integer_strategies_reach_both_boundaries() {
        assert_eq!(
            generated(
                "n : int [-5, 9]",
                GeneratorStrategy::Minimum,
                TreeShape::Random,
                1
            ),
            "-5"
        );
        assert_eq!(
            generated(
                "n : int [-5, 9]",
                GeneratorStrategy::Maximum,
                TreeShape::Random,
                1
            ),
            "9"
        );
    }

    #[test]
    fn array_has_requested_length() {
        let output = generated(
            "n : int [20, 20]\na : array[n] int [1, 100]",
            GeneratorStrategy::Random,
            TreeShape::Random,
            9,
        );
        assert_eq!(
            output.lines().nth(1).unwrap().split_whitespace().count(),
            20
        );
    }

    #[test]
    fn permutation_contains_every_value_once() {
        let output = generated(
            "p : permutation(100)",
            GeneratorStrategy::Random,
            TreeShape::Random,
            42,
        );
        let values: HashSet<i64> = output
            .split_whitespace()
            .map(|value| value.parse().unwrap())
            .collect();
        assert_eq!(values.len(), 100);
        assert!(values.contains(&1) && values.contains(&100));
    }

    #[test]
    fn dependent_bounds_keep_l_not_greater_than_r() {
        let output = generated(
            "q : int [100, 100]\nrepeat q:\n  l : int [1, 100]\n  r : int [l, 100]",
            GeneratorStrategy::Random,
            TreeShape::Random,
            77,
        );
        let values: Vec<i64> = output
            .lines()
            .skip(1)
            .map(|line| line.parse().unwrap())
            .collect();
        for pair in values.chunks_exact(2) {
            assert!(pair[0] <= pair[1]);
        }
    }

    #[test]
    fn tree_is_connected_and_has_n_minus_one_edges() {
        let output = generated(
            "edges : tree(250)",
            GeneratorStrategy::Random,
            TreeShape::Mixed,
            2025,
        );
        let edges: Vec<(usize, usize)> = output
            .lines()
            .map(|line| {
                let mut values = line.split_whitespace().map(|value| value.parse().unwrap());
                (values.next().unwrap(), values.next().unwrap())
            })
            .collect();
        assert_eq!(edges.len(), 249);
        let mut parent: Vec<usize> = (0..=250).collect();
        for (left, right) in edges {
            let left_root = root(&mut parent, left);
            let right_root = root(&mut parent, right);
            parent[left_root] = right_root;
        }
        let first = root(&mut parent, 1);
        assert!((2..=250).all(|node| root(&mut parent, node) == first));
    }

    #[test]
    fn graph_has_no_self_loops_or_duplicate_edges() {
        let output = generated(
            "edges : connected_graph(100, 400)",
            GeneratorStrategy::Random,
            TreeShape::Random,
            12,
        );
        let mut edges = HashSet::new();
        for line in output.lines() {
            let values: Vec<usize> = line
                .split_whitespace()
                .map(|value| value.parse().unwrap())
                .collect();
            assert_ne!(values[0], values[1]);
            assert!(edges.insert(normalized_edge(values[0], values[1])));
        }
        assert_eq!(edges.len(), 400);
    }

    #[test]
    fn same_seed_and_settings_are_deterministic() {
        let dsl = "n : int [5, 50]\na : array[n] int [-1000, 1000]\nt : tree(n)";
        let first = generated(dsl, GeneratorStrategy::Mixed, TreeShape::Mixed, u64::MAX);
        let second = generated(dsl, GeneratorStrategy::Mixed, TreeShape::Mixed, u64::MAX);
        assert_eq!(first, second);
    }

    #[test]
    fn visual_line_outputs_multiple_fields_on_one_line() {
        let output = visual_generated(
            vec![VisualNode::Line {
                id: "line".into(),
                fields: vec![
                    VisualField::Integer {
                        id: "n".into(),
                        name: "n".into(),
                        minimum: visual_constant(5),
                        maximum: visual_constant(5),
                    },
                    VisualField::Integer {
                        id: "q".into(),
                        name: "q".into(),
                        minimum: visual_constant(7),
                        maximum: visual_constant(7),
                    },
                ],
            }],
            1,
        );
        assert_eq!(output, "5 7");
    }

    #[test]
    fn visual_repeat_and_array_resolve_scoped_variables() {
        let output = visual_generated(
            vec![
                VisualNode::Line {
                    id: "t-line".into(),
                    fields: vec![VisualField::Integer {
                        id: "t".into(),
                        name: "T".into(),
                        minimum: visual_constant(2),
                        maximum: visual_constant(2),
                    }],
                },
                VisualNode::Repeat {
                    id: "repeat".into(),
                    count: visual_variable("T"),
                    children: vec![
                        VisualNode::Line {
                            id: "n-line".into(),
                            fields: vec![VisualField::Integer {
                                id: "n".into(),
                                name: "n".into(),
                                minimum: visual_constant(3),
                                maximum: visual_constant(3),
                            }],
                        },
                        VisualNode::Line {
                            id: "array-line".into(),
                            fields: vec![VisualField::Array {
                                id: "array".into(),
                                name: "a".into(),
                                length: visual_variable("n"),
                                minimum: visual_constant(9),
                                maximum: visual_constant(9),
                                strategy: None,
                            }],
                        },
                    ],
                },
            ],
            8,
        );
        assert_eq!(output, "2\n3\n9 9 9\n3\n9 9 9");
    }

    #[test]
    fn visual_tree_and_graph_use_integer_references() {
        let output = visual_generated(
            vec![
                VisualNode::Line {
                    id: "header".into(),
                    fields: vec![
                        VisualField::Integer {
                            id: "n".into(),
                            name: "n".into(),
                            minimum: visual_constant(5),
                            maximum: visual_constant(5),
                        },
                        VisualField::Integer {
                            id: "m".into(),
                            name: "m".into(),
                            minimum: visual_constant(6),
                            maximum: visual_constant(6),
                        },
                    ],
                },
                VisualNode::Tree {
                    id: "tree".into(),
                    nodes: visual_variable("n"),
                    index_base: 0,
                    shape: Some(TreeShape::Chain),
                    weight: None,
                },
                VisualNode::Graph {
                    id: "graph".into(),
                    nodes: visual_variable("n"),
                    edges: visual_variable("m"),
                    index_base: 1,
                    kind: VisualGraphKind::SimpleUndirected,
                },
            ],
            99,
        );
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines[0], "5 6");
        assert_eq!(&lines[1..5], &["0 1", "1 2", "2 3", "3 4"]);
        assert_eq!(lines.len(), 11);
    }

    #[test]
    fn visual_generation_remains_deterministic() {
        let nodes = vec![VisualNode::Line {
            id: "line".into(),
            fields: vec![VisualField::Integer {
                id: "n".into(),
                name: "n".into(),
                minimum: visual_constant(-1_000_000),
                maximum: visual_constant(1_000_000),
            }],
        }];
        assert_eq!(
            visual_generated(nodes.clone(), u64::MAX),
            visual_generated(nodes, u64::MAX)
        );
    }

    #[test]
    fn visual_repeat_supports_dependent_fields_and_nesting() {
        let query_line = VisualNode::Line {
            id: "query-line".into(),
            fields: vec![
                VisualField::Integer {
                    id: "l".into(),
                    name: "l".into(),
                    minimum: visual_constant(1),
                    maximum: visual_variable("n"),
                },
                VisualField::Integer {
                    id: "r".into(),
                    name: "r".into(),
                    minimum: visual_variable("l"),
                    maximum: visual_variable("n"),
                },
            ],
        };
        let output = visual_generated(
            vec![
                VisualNode::Line {
                    id: "header".into(),
                    fields: vec![
                        VisualField::Integer {
                            id: "n".into(),
                            name: "n".into(),
                            minimum: visual_constant(100),
                            maximum: visual_constant(100),
                        },
                        VisualField::Integer {
                            id: "q".into(),
                            name: "q".into(),
                            minimum: visual_constant(4),
                            maximum: visual_constant(4),
                        },
                    ],
                },
                VisualNode::Repeat {
                    id: "outer".into(),
                    count: visual_constant(2),
                    children: vec![VisualNode::Repeat {
                        id: "inner".into(),
                        count: visual_variable("q"),
                        children: vec![query_line],
                    }],
                },
            ],
            55,
        );
        assert_eq!(output.lines().count(), 9);
        for line in output.lines().skip(1) {
            let values: Vec<i64> = line
                .split_whitespace()
                .map(|value| value.parse().unwrap())
                .collect();
            assert!(1 <= values[0] && values[0] <= values[1] && values[1] <= 100);
        }
    }

    fn root(parent: &mut [usize], node: usize) -> usize {
        if parent[node] != node {
            parent[node] = root(parent, parent[node]);
        }
        parent[node]
    }
}
