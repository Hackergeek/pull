import type { Logger, ProbotOctokit } from "probot";
import { appConfig } from "@/src/configs/app-config.ts";
import { SchedulerJobData } from "@wei/probot-scheduler";
import { PullConfig, pullConfigSchema } from "@/src/utils/schema.ts";

async function getLivePullConfig(
  octokit: ProbotOctokit,
  log: Logger,
  jobData: SchedulerJobData,
): Promise<PullConfig | null> {
  log.debug(`⚙️ Fetching live config`);

  const { owner, repo } = jobData;

  const { config } = await octokit.config.get({
    owner,
    repo,
    path: `.github/${appConfig.configFilename}`,
  });

  // Log config if found
  if (!config || !config.version) {
    log.warn("⚠️ No config found");
    return null;
  } else {
    log.info({ config }, "⚙️ Config found");
  }

  const result = pullConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error("Invalid config");
  }

  return result.data;
}

async function getDefaultPullConfig(
  octokit: ProbotOctokit,
  log: Logger,
  jobData: SchedulerJobData,
): Promise<PullConfig | null> {
  log.debug(`⚙️ Fetching default config`);

  const { owner, repo } = jobData;

  const repoInfo = await octokit.repos.get({
    owner,
    repo,
  });

  if (repoInfo.data && repoInfo.data.fork && repoInfo.data.parent) {
    const upstreamOwner = repoInfo.data.parent.owner &&
      repoInfo.data.parent.owner.login;
    const defaultBranch = repoInfo.data.parent.default_branch;

    if (upstreamOwner && defaultBranch) {
      log.debug(
        `Using default config ${defaultBranch}...${upstreamOwner}:${defaultBranch}`,
      );

      const defaultConfig = {
        version: "1",
        rules: [
          {
            base: `${defaultBranch}`,
            upstream: `${upstreamOwner}:${defaultBranch}`,
            mergeMethod: appConfig.defaultMergeMethod,
          },
        ],
      };

      const result = pullConfigSchema.safeParse(defaultConfig);
      if (!result.success) {
        throw new Error("Invalid default config");
      }

      return result.data;
    }
  }

  return null;
}

export async function getPullConfig(
  octokit: ProbotOctokit,
  log: Logger,
  jobData: SchedulerJobData,
): Promise<PullConfig | null> {
  log.info(`⚙️ Fetching config`);

  const { owner, repo } = jobData;

  const { data: repository } = await octokit.rest.repos.get({ owner, repo });

  if (repository.archived) {
    log.debug(`⚠️ Repository is archived, skipping`);
    return null; // TODO Cancel scheduled job
  }

  let config = await getLivePullConfig(octokit, log, jobData);
  if (!config && !repository.fork) {
    return null; // TODO Cancel scheduled job
  } else if (!config) {
    config = await getDefaultPullConfig(octokit, log, jobData);
  }

  return config;
}
