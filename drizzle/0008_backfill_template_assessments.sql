WITH pending AS (
  SELECT ta.cycle_id, ta.employee_no, ta.template_id, t.layout,
    GREATEST(COALESCE(jsonb_array_length(t.layout->'rows'), 0), 1) AS row_count
  FROM template_assignments ta
  JOIN indicator_templates t ON t.id = ta.template_id
  LEFT JOIN assessments a ON a.cycle_id = ta.cycle_id AND a.employee_no = ta.employee_no
  WHERE a.id IS NULL
)
INSERT INTO assessments (id, cycle_id, employee_no, template_id)
SELECT md5('template-assessment:' || cycle_id || ':' || employee_no), cycle_id, employee_no, template_id
FROM pending
ON CONFLICT (cycle_id, employee_no) DO NOTHING;
--> statement-breakpoint
WITH pending AS (
  SELECT ta.cycle_id, ta.employee_no, ta.template_id, t.layout,
    GREATEST(COALESCE(jsonb_array_length(t.layout->'rows'), 0), 1) AS row_count
  FROM template_assignments ta
  JOIN indicator_templates t ON t.id = ta.template_id
  JOIN assessments a ON a.cycle_id = ta.cycle_id AND a.employee_no = ta.employee_no AND a.template_id = ta.template_id
)
INSERT INTO indicator_nodes (id, assessment_id, parent_id, node_code, name, description, scoring_rule, max_score, sort_order)
SELECT md5(a.id || ':R'), a.id, NULL, 'R', '年度考核', '', '', 100, 0
FROM pending p
JOIN assessments a ON a.cycle_id = p.cycle_id AND a.employee_no = p.employee_no
ON CONFLICT (assessment_id, node_code) DO NOTHING;
--> statement-breakpoint
WITH pending AS (
  SELECT ta.cycle_id, ta.employee_no, t.layout,
    GREATEST(COALESCE(jsonb_array_length(t.layout->'rows'), 0), 1) AS row_count
  FROM template_assignments ta
  JOIN indicator_templates t ON t.id = ta.template_id
  JOIN assessments a ON a.cycle_id = ta.cycle_id AND a.employee_no = ta.employee_no AND a.template_id = ta.template_id
)
INSERT INTO indicator_nodes (id, assessment_id, parent_id, node_code, name, description, scoring_rule, max_score, sort_order)
SELECT md5(a.id || ':T' || row_number), a.id, md5(a.id || ':R'), 'T' || row_number,
  COALESCE(NULLIF(p.layout->'rows'->(row_number - 1)->>'label', ''), '待填写指标 ' || row_number), '', '',
  CASE WHEN row_number = p.row_count THEN 100 - ROUND((100.0 / p.row_count) * (p.row_count - 1), 2) ELSE ROUND(100.0 / p.row_count, 2) END,
  row_number
FROM pending p
JOIN assessments a ON a.cycle_id = p.cycle_id AND a.employee_no = p.employee_no
CROSS JOIN LATERAL generate_series(1, p.row_count) AS series(row_number)
ON CONFLICT (assessment_id, node_code) DO NOTHING;
