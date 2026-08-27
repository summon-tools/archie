import { NextRequest, NextResponse } from "next/server";
import { getGitHubAppInstallationToken, getGitHubAppSettings } from "@/lib/server/github-app";
import { getGitHubPullRequestIdentity, getGitHubReviewCommentIdentity } from "@/lib/server/github-review-api";
import * as dal from "@/lib/server/dal";
import { verifyGitHubWebhookSignature } from "@/lib/server/github-webhook";
import { startPullRequestReview } from "@/lib/server/pull-request-review-jobs";
import { startReviewThreadInteraction } from "@/lib/server/review-thread-jobs";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseReviewCommand(body: string | null, botUsername: string): "targeted" | "full" | null {
  if (!body) return null;
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;
  const marker = tokens.shift()?.toLowerCase();
  const expected = botUsername.trim().toLowerCase() || "archie";
  if (marker !== `/${expected}` && marker !== `@${expected}`) return null;
  const command = tokens.map((token) => token.toLowerCase());
  if (command.length === 1 && command[0] === "review") return "targeted";
  if (command.length === 2 && command.includes("review") && command.includes("full")) return "full";
  return null;
}

function isAuthorizedReviewCommand(comment: any): boolean {
  const association = asString(comment?.author_association)?.toUpperCase();
  return association === "OWNER" || association === "MEMBER" || association === "COLLABORATOR";
}

function isAuthorizedThreadMention(payload: any): boolean {
  if (isAuthorizedReviewCommand(payload?.comment)) return true;
  const commenter = asString(payload?.comment?.user?.login)?.toLowerCase();
  const pullRequestAuthor = asString(payload?.pull_request?.user?.login)?.toLowerCase();
  return Boolean(commenter && pullRequestAuthor && commenter === pullRequestAuthor);
}

export async function POST(request: NextRequest) {
  const deliveryId = asString(request.headers.get("x-github-delivery"));
  const eventName = asString(request.headers.get("x-github-event"));
  if (!deliveryId || !eventName) {
    return NextResponse.json({ detail: "GitHub delivery and event headers are required" }, { status: 400 });
  }

  const rawBody = await request.text();
  const settings = getGitHubAppSettings();
  if (!settings.webhook_secret) {
    return NextResponse.json({ detail: "GitHub webhook secret is not configured" }, { status: 503 });
  }
  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), settings.webhook_secret)) {
    return NextResponse.json({ detail: "Invalid GitHub webhook signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ detail: "Invalid GitHub webhook JSON" }, { status: 400 });
  }

  const repository = payload?.repository;
  const fullName = asString(repository?.full_name);
  const [ownerFromFullName, repoFromFullName] = fullName?.split("/", 2) || [];
  const owner = asString(ownerFromFullName || repository?.owner?.login);
  const repo = asString(repoFromFullName || repository?.name);
  const pullRequest = payload?.pull_request;
  const requestedReviewer = pullRequest?.requested_reviewers?.[0]?.login || payload?.requested_reviewer?.login;

  if (eventName === "pull_request_review_comment") {
    const comment = payload?.comment;
    const commentBody = asString(comment?.body);
    const installationId = asPositiveInteger(payload?.installation?.id);
    const prNumber = asPositiveInteger(payload?.pull_request?.number);
    const inReplyToId = asPositiveInteger(comment?.in_reply_to_id);
    const botMention = `@${settings.bot_username || "archie"}`.toLowerCase();
    const isMention = Boolean(commentBody && commentBody.toLowerCase().includes(botMention));
    const recordReceipt = () => dal.recordGitHubWebhookReceipt({
      delivery_id: deliveryId,
      event_name: eventName,
      action: asString(payload?.action),
      installation_id: installationId,
      owner,
      repo,
      head_sha: asString(payload?.pull_request?.head?.sha),
      payload_json: rawBody,
    });
    if (payload?.action !== "created" || !owner || !repo || !installationId || !prNumber || !inReplyToId || !isMention || !isAuthorizedThreadMention(payload)) {
      if (!recordReceipt()) return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
      return NextResponse.json({ accepted: true, status: "ignored", reason: "thread_mention_not_supported" }, { status: 202 });
    }

    const mapped = dal.getProjectRepository(owner, repo);
    let rootFinding = dal.getReviewFindingByGitHubCommentId(inReplyToId);
    let review = rootFinding ? dal.getPullRequestReview(rootFinding.review_id) : undefined;
    if (!review) {
      try {
        const token = (await getGitHubAppInstallationToken(installationId, repo)).token;
        const rootComment = await getGitHubReviewCommentIdentity({ owner, repo, commentId: inReplyToId, token });
        review = dal.getPullRequestReviewByGitHubReviewId(rootComment.pull_request_review_id);
        if (review && rootComment.path && rootComment.line) {
          const title = rootComment.body.match(/^\*\*(.+?)\*\*/)?.[1]?.trim() || null;
          rootFinding = dal.getReviewFindingForLocation(review.id, rootComment.path, rootComment.line, title);
          if (rootFinding) {
            dal.updateReviewFinding(rootFinding.id, { github_comment_id: inReplyToId });
          }
        }
      } catch (error) {
        return NextResponse.json({
          accepted: false,
          status: "retry",
          reason: "thread_root_lookup_failed",
          detail: error instanceof Error ? error.message : "Unable to resolve the root review comment.",
        }, { status: 503 });
      }
    }
    if (!recordReceipt()) return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
    if (!mapped || mapped.state !== "active" || mapped.installation_id !== installationId || !review
      || review.owner.toLowerCase() !== owner.toLowerCase() || review.repo.toLowerCase() !== repo.toLowerCase()
      || review.pr_number !== prNumber) {
      return NextResponse.json({ accepted: true, status: "ignored", reason: "thread_review_not_owned_by_archie" }, { status: 202 });
    }
    const interaction = dal.createReviewThreadInteraction({
      review_id: review.id,
      github_comment_id: Number(comment.id),
      author_login: asString(comment?.user?.login),
      mention_text: commentBody || "",
      raw_json: rawBody,
    });
    startReviewThreadInteraction(interaction.github_comment_id);
    return NextResponse.json({ accepted: true, status: "queued", interaction_id: interaction.id }, { status: 202 });
  }

  if (eventName === "issue_comment") {
    const comment = payload?.comment;
    const command = parseReviewCommand(asString(comment?.body), settings.bot_username);
    const prNumber = asPositiveInteger(payload?.issue?.number);
    const installationId = asPositiveInteger(payload?.installation?.id);
    const isPullRequest = Boolean(payload?.issue?.pull_request);

    if (!command) {
      if (!dal.recordGitHubWebhookReceipt({
        delivery_id: deliveryId,
        event_name: eventName,
        action: asString(payload?.action),
        installation_id: installationId,
        owner,
        repo,
        payload_json: rawBody,
      })) {
        return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
      }
      return NextResponse.json({ accepted: true, status: "ignored", reason: "review_command_not_found" }, { status: 202 });
    }

    if (payload?.action !== "created") {
      return NextResponse.json({ accepted: true, status: "ignored", reason: "comment_action_not_supported" }, { status: 202 });
    }

    if (!isPullRequest) {
      if (!dal.recordGitHubWebhookReceipt({
        delivery_id: deliveryId,
        event_name: eventName,
        action: "review_command",
        installation_id: installationId,
        owner,
        repo,
        payload_json: rawBody,
      })) {
        return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
      }
      return NextResponse.json({ accepted: true, status: "ignored", reason: "not_a_pull_request" }, { status: 202 });
    }

    if (!isAuthorizedReviewCommand(comment)) {
      if (!dal.recordGitHubWebhookReceipt({
        delivery_id: deliveryId,
        event_name: eventName,
        action: "review_command",
        installation_id: installationId,
        owner,
        repo,
        payload_json: rawBody,
      })) {
        return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
      }
      return NextResponse.json({ accepted: true, status: "ignored", reason: "review_command_not_authorized" }, { status: 202 });
    }

    if (!owner || !repo || !installationId || !prNumber) {
      if (!dal.recordGitHubWebhookReceipt({
        delivery_id: deliveryId,
        event_name: eventName,
        action: "review_command",
        installation_id: installationId,
        owner,
        repo,
        payload_json: rawBody,
      })) {
        return NextResponse.json({ accepted: true, duplicate: true, status: "received" }, { status: 202 });
      }
      return NextResponse.json({ accepted: true, status: "ignored", reason: "pull_request_identity_incomplete" }, { status: 202 });
    }

    const mappedRepository = dal.getProjectRepository(owner, repo);
    if (!mappedRepository || mappedRepository.state !== "active" || mappedRepository.installation_id !== installationId) {
      const result = dal.queuePullRequestReviewFromWebhook({
        delivery_id: deliveryId,
        event_name: eventName,
        action: "review_command",
        installation_id: installationId,
        owner,
        repo,
        pr_number: prNumber,
        base_sha: null,
        head_sha: null,
        requested_reviewer_login: settings.bot_username || "archie",
        review_mode: command,
        payload_json: rawBody,
      });
      return NextResponse.json({
        accepted: true,
        duplicate: result.duplicate,
        status: result.event.status,
        reason: result.reason,
        event_id: result.event.id,
        review_id: result.review?.id || result.event.review_id,
      }, { status: 202 });
    }

    try {
      const token = (await getGitHubAppInstallationToken(installationId, repo)).token;
      const identity = await getGitHubPullRequestIdentity({ owner, repo, prNumber, token });
      const previousReview = dal.getLatestCompletedPullRequestReview(owner, repo, prNumber);
      const result = dal.queuePullRequestReviewFromWebhook({
        delivery_id: deliveryId,
        event_name: eventName,
        action: "review_command",
        installation_id: installationId,
        owner,
        repo,
        pr_number: prNumber,
        base_sha: identity.base_sha,
        head_sha: identity.head_sha,
        requested_reviewer_login: settings.bot_username || "archie",
        review_mode: command,
        previous_review_id: previousReview?.id || null,
        payload_json: rawBody,
      });

      if (result.review && !result.duplicate) startPullRequestReview(result.review.id);
      return NextResponse.json({
        accepted: true,
        duplicate: result.duplicate,
        status: result.event.status,
        reason: result.reason,
        event_id: result.event.id,
        review_id: result.review?.id || result.event.review_id,
      }, { status: 202 });
    } catch (error) {
      return NextResponse.json({
        accepted: false,
        status: "retry",
        reason: "pull_request_lookup_failed",
        detail: error instanceof Error ? error.message : "Unable to load the pull request for review.",
      }, { status: 503 });
    }
  }

  const result = dal.queuePullRequestReviewFromWebhook({
    delivery_id: deliveryId,
    event_name: eventName,
    action: asString(payload?.action),
    installation_id: asPositiveInteger(payload?.installation?.id),
    owner,
    repo,
    pr_number: asPositiveInteger(payload?.number || pullRequest?.number),
    base_sha: asString(pullRequest?.base?.sha),
    head_sha: asString(pullRequest?.head?.sha),
    requested_reviewer_login: asString(requestedReviewer),
    payload_json: rawBody,
  });

  if (result.review && !result.duplicate) {
    startPullRequestReview(result.review.id);
  }

  return NextResponse.json({
    accepted: true,
    duplicate: result.duplicate,
    status: result.event.status,
    reason: result.reason,
    event_id: result.event.id,
    review_id: result.review?.id || result.event.review_id,
  }, { status: 202 });
}
