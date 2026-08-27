# Setup

1. Copy these files into the root of your profile repository:
   `Sakif16/Sakif16`

2. Create a repository secret named:
   `PROFILE_GH_TOKEN`

3. Put a GitHub token into that secret that is allowed to read the contribution
   information for `Sakif16`.

4. Push the repository.

The custom animations use GIF only. There are no SVG assets and no JavaScript
inside the README.

The daily workflow:
  - fetches the contribution calendar,
  - writes data/contributions.json,
  - rebuilds assets/telemetry.gif,
  - commits the refreshed telemetry.
