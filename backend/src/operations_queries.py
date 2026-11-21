"""Business queries over authoritative project records."""

VIEWS = {
    'specimen-repeatability': (
        '试片测量重复性',
        '按冻干曲线和试片阶段对照原测与复测，差值超过 0.5 mm 时交计量主管复核。',
        ['批次', '曲线', '试片', '阶段', '原测 mm', '复测 mm', '绝对差 mm', '判定'],
        """
SELECT b.code, r.id, s.specimen, s.stage,
       AVG(CASE WHEN NOT s.is_retest THEN s.thickness_mm END),
       AVG(CASE WHEN s.is_retest THEN s.thickness_mm END),
       ABS(AVG(CASE WHEN NOT s.is_retest THEN s.thickness_mm END) - AVG(CASE WHEN s.is_retest THEN s.thickness_mm END)),
       CASE WHEN COUNT(CASE WHEN NOT s.is_retest THEN 1 END) = 0 THEN '缺原测'
            WHEN COUNT(CASE WHEN s.is_retest THEN 1 END) = 0 THEN '待复测'
            WHEN ABS(AVG(CASE WHEN NOT s.is_retest THEN s.thickness_mm END) - AVG(CASE WHEN s.is_retest THEN s.thickness_mm END)) > 0.5 THEN '差值超限'
            ELSE '一致' END
FROM dry_batches b JOIN chamber_runs r ON r.batch_code=b.code JOIN shrinkage_samples s ON s.run_id=r.id
GROUP BY b.code,r.id,s.specimen,s.stage ORDER BY r.id DESC,s.specimen,s.stage
""",
    ),
}
