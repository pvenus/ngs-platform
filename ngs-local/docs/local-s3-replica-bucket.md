# Local S3 replica storage adapter

The optional local object driver uses the official AWS JS S3 client to access
only the operator-managed loopback S3 endpoint at `http://127.0.0.1:9000`.
No AWS default identity or external endpoint is used. Pass an owner-controlled
absolute path to a mode-0600 JSON file outside the repository containing
`{bucketName,accessKeyId,secretAccessKey}`. Do not commit or print the file.

Import `openLocalS3ReplicaBucket({configPath})` and pass its result as
`bucket` to the common replica. Pass the multipart hook
`writePart: (upload, part, body, size) => upload.uploadPart(part, body, size)`.
This supplies the exact part content length to the SDK without buffering the
file or entire part. Call `bucket.close()` when retiring the local service.

The backend must honor native conditional create (`If-None-Match: *`) on
single PUT and multipart completion, conditional ranged GET (`If-Match`),
and S3 SHA-256 checksums on single PUT. The adapter has no unsafe fallback
that discards a condition. Test the exact provider release on a disposable
bucket before activation; mock tests validate the wire contract but cannot
prove provider semantics. S3 listings do not carry user metadata, so listing
with `include: ['customMetadata']` performs up to eight concurrent HEADs and
fails closed if the object changes while listing.
