import type { PermissionScope } from "./types";

export type PermissionPromptChoice = "allow_once" | "allow_remember" | "deny";

export interface PermissionPromptRequest {
  toolName: string;
  argument: string;
  suggestedPattern: string;
}

export interface PermissionPromptResponse {
  choice: PermissionPromptChoice;
  pattern?: string;
  scope?: Exclude<PermissionScope, "session">;
}

export type PermissionPromptHandler = (
  request: PermissionPromptRequest,
) => Promise<PermissionPromptResponse>;
