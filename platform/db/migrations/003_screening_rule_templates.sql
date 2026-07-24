CREATE TABLE IF NOT EXISTS screening_rule_templates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    value TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_rule_templates_normalized_label
    ON screening_rule_templates(normalized_label);

INSERT INTO screening_rule_templates (id, type, label, normalized_label, value, data)
VALUES
    (
        'rule-template-postgraduate-research',
        '硬性门槛',
        '研究生或同等研究/工作经历',
        '研究生或同等研究/工作经历',
        '优先识别硕士/博士在读或毕业；本科候选人需由长期高质量科研、核心业务实习或同等强度工作经历补充说明，不能由普通项目经历直接替代。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-school-tier',
        '硬性门槛',
        '985/211/双一流或同等层次院校',
        '985/211/双一流或同等层次院校',
        '模型需结合院校层次判断：985/211、双一流、中科院、南方科大/上科大等新型高水平院校，以及海外同等层次高校；不确定时标为需人工复核。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-creativity',
        '评价维度',
        '创意与创造力',
        '创意与创造力',
        '不仅看点子新不新，还要能说明使用场景、用户价值和可落地路径。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-business-value',
        '评价维度',
        '业务实用性',
        '业务实用性',
        '能解释作品对部门、智能云或内部业务的实际效率、质量或成本价值。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-cloud-value',
        '评价维度',
        '智能云/内部业务价值',
        '智能云/内部业务价值',
        '能和智能云现有产品、内部流程或平台能力结合，而不是单纯概念展示。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-engineering',
        '评价维度',
        '工程落地',
        '工程落地',
        '能说明架构、数据、接口、稳定性和可演示链路。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-product-expression',
        '评价维度',
        '产品表达',
        '产品表达',
        '能讲清用户是谁、痛点是什么、怎么使用、为什么值得做。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-persistence-reflection',
        '评价维度',
        '坚持与复盘能力',
        '坚持与复盘能力',
        '能说明做作品过程中遇到的困难、取舍、迭代和后续改进。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-education-risk',
        '风险核验',
        '学历/院校不确定',
        '学历/院校不确定',
        '简历信息缺失、海外院校不熟悉或学校层次不确定时，进入人工复核，不自动否定。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-work-authenticity',
        '风险核验',
        '作品真实性不清',
        '作品真实性不清',
        '作品无法验证、贡献边界模糊或表达不清时，需要在 AI 面试/人审中重点确认。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-contribution-boundary',
        '风险核验',
        '本人贡献边界模糊',
        '本人贡献边界模糊',
        '候选人需要说明自己具体负责的模块、关键决策和可验证证据。',
        '{"seed": true}'::jsonb
    ),
    (
        'rule-template-evidence-gap',
        '风险核验',
        '证据缺口',
        '证据缺口',
        '轻微证据不足进入 AI 面试核验；严重缺少可引用证据时，初筛不建议继续。',
        '{"seed": true}'::jsonb
    )
ON CONFLICT (normalized_label) DO NOTHING;
