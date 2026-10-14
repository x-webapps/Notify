import guide from "./android-guide.md?raw";
import { KOTLIN_SNIPPET } from "./audience";

/** The agent-ready Android integration brief, with the shared PushTopics helper inserted. */
export function androidGuide(): string {
  return guide.replace("{{PUSH_TOPICS_KT}}", KOTLIN_SNIPPET.trimEnd());
}
