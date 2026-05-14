import boto3, sys, os

s3 = boto3.client(
    's3',
    endpoint_url='https://e676e34c04ae97499018af663941cca0.r2.cloudflarestorage.com',
    aws_access_key_id=os.environ['KINDPOS_R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['KINDPOS_R2_SECRET_ACCESS_KEY'],
    region_name='auto',
    config=boto3.session.Config(
        signature_version='s3v4',
        request_checksum_calculation='when_required',
        response_checksum_validation='when_required',
    )
)

local_path = sys.argv[1]
object_name = sys.argv[2]
from boto3.s3.transfer import TransferConfig

config = TransferConfig(
    multipart_threshold=1024 * 1024 * 1024,  # 1GB — never multipart
    max_concurrency=1,
)

s3.upload_file(local_path, 'kindpos-installers', object_name, Config=config)
print(f"Uploaded {object_name}")
