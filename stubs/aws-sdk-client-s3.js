// Minimal stub used during Next.js bundling to avoid pulling in the full AWS SDK.
// The project only relies on `unzipper` for local file extraction, so any attempt
// to use the S3 helpers should surface a clear runtime error instead of bundling
// and failing during build.
class UnsupportedS3Command {
  constructor() {
    throw new Error(
      "@aws-sdk/client-s3 is not available in this build. " +
        "The unzipper S3 helpers are unsupported."
    );
  }
}

module.exports = {
  GetObjectCommand: UnsupportedS3Command,
  HeadObjectCommand: UnsupportedS3Command,
};
