// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-004

//! Entity dependency ordering via topological sort.
//!
//! Factory entities can reference each other (e.g. `Site` references `Organization`).
//! Scaffolding steps must generate referenced entities before referencing ones.

use crate::FactoryError;
use factory_contracts::build_spec::Entity;
use std::collections::{HashMap, HashSet, VecDeque};

/// Returns entity names in dependency order (referenced entities first).
///
/// If entity `Site` has a field with `ref_entity: Some("Organization")`,
/// then `Organization` appears before `Site` in the output.
pub fn topological_sort_entities(entities: &[Entity]) -> Result<Vec<String>, FactoryError> {
    let name_set: HashSet<&str> = entities.iter().map(|e| e.name.as_str()).collect();
    let name_to_idx: HashMap<&str, usize> = entities
        .iter()
        .enumerate()
        .map(|(i, e)| (e.name.as_str(), i))
        .collect();

    let n = entities.len();
    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
    let mut indegree = vec![0u32; n];

    for (consumer_idx, entity) in entities.iter().enumerate() {
        for field in &entity.fields {
            if let Some(ref ref_entity) = field.ref_entity {
                if !name_set.contains(ref_entity.as_str()) {
                    // Reference to unknown entity — skip (may be external).
                    continue;
                }
                if let Some(&producer_idx) = name_to_idx.get(ref_entity.as_str())
                    && producer_idx != consumer_idx
                {
                    adj[producer_idx].push(consumer_idx);
                    indegree[consumer_idx] += 1;
                }
            }
        }
    }

    // Kahn's algorithm
    let mut queue: VecDeque<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);

    while let Some(u) = queue.pop_front() {
        order.push(u);
        for &v in &adj[u] {
            indegree[v] -= 1;
            if indegree[v] == 0 {
                queue.push_back(v);
            }
        }
    }

    if order.len() != n {
        // Find cycle participants for error message.
        let in_cycle: Vec<&str> = (0..n)
            .filter(|i| indegree[*i] > 0)
            .map(|i| entities[i].name.as_str())
            .collect();
        return Err(FactoryError::CircularReference {
            cycle: in_cycle.join(" <-> "),
        });
    }

    Ok(order
        .into_iter()
        .map(|i| entities[i].name.clone())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::build_spec::{Entity, Field, FieldType};

    fn entity(name: &str, fields: Vec<Field>) -> Entity {
        Entity {
            name: name.into(),
            description: Some(format!("{name} entity")),
            fields,
            unique_constraints: None,
            check_constraints: None,
            indexes: None,
            business_rules: None,
        }
    }

    fn plain_field(name: &str) -> Field {
        Field {
            name: name.into(),
            field_type: FieldType::String,
            primary: false,
            required: false,
            unique: None,
            default: None,
            description: Some(format!("{name} field")),
            enum_values: None,
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: None,
            ref_field: None,
            ref_on_delete: None,
        }
    }

    fn ref_field(name: &str, ref_entity: &str) -> Field {
        Field {
            name: name.into(),
            field_type: FieldType::Uuid,
            primary: false,
            required: true,
            unique: None,
            default: None,
            description: Some(format!("ref to {ref_entity}")),
            enum_values: None,
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: Some(ref_entity.into()),
            ref_field: None,
            ref_on_delete: None,
        }
    }

    #[test]
    fn linear_dependency_chain() {
        let entities = vec![
            entity("Site", vec![ref_field("org_id", "Organization")]),
            entity("Organization", vec![plain_field("name")]),
            entity("Room", vec![ref_field("site_id", "Site")]),
        ];
        let sorted = topological_sort_entities(&entities).unwrap();
        let org_pos = sorted.iter().position(|n| n == "Organization").unwrap();
        let site_pos = sorted.iter().position(|n| n == "Site").unwrap();
        let room_pos = sorted.iter().position(|n| n == "Room").unwrap();
        assert!(org_pos < site_pos);
        assert!(site_pos < room_pos);
    }

    #[test]
    fn independent_entities() {
        let entities = vec![
            entity("Alpha", vec![plain_field("name")]),
            entity("Beta", vec![plain_field("name")]),
            entity("Gamma", vec![plain_field("name")]),
        ];
        let sorted = topological_sort_entities(&entities).unwrap();
        assert_eq!(sorted.len(), 3);
    }

    #[test]
    fn circular_reference_detected() {
        let entities = vec![
            entity("A", vec![ref_field("b_id", "B")]),
            entity("B", vec![ref_field("a_id", "A")]),
        ];
        let result = topological_sort_entities(&entities);
        assert!(matches!(
            result,
            Err(FactoryError::CircularReference { .. })
        ));
    }

    #[test]
    fn diamond_dependency() {
        // D depends on B and C; B and C both depend on A
        let entities = vec![
            entity("D", vec![ref_field("b_id", "B"), ref_field("c_id", "C")]),
            entity("B", vec![ref_field("a_id", "A")]),
            entity("C", vec![ref_field("a_id", "A")]),
            entity("A", vec![plain_field("name")]),
        ];
        let sorted = topological_sort_entities(&entities).unwrap();
        let a_pos = sorted.iter().position(|n| n == "A").unwrap();
        let b_pos = sorted.iter().position(|n| n == "B").unwrap();
        let c_pos = sorted.iter().position(|n| n == "C").unwrap();
        let d_pos = sorted.iter().position(|n| n == "D").unwrap();
        assert!(a_pos < b_pos);
        assert!(a_pos < c_pos);
        assert!(b_pos < d_pos);
        assert!(c_pos < d_pos);
    }
}
