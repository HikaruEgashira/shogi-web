output "bucket_name" { value = aws_s3_bucket.site.id }
output "distribution_id" { value = aws_cloudfront_distribution.site.id }
output "site_url" { value = "https://${local.domain_name}" }
output "cloudfront_domain" { value = aws_cloudfront_distribution.site.domain_name }
output "certificate_validation_records" { value = aws_acm_certificate.site.domain_validation_options }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
