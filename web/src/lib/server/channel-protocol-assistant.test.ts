import { describe, expect, it } from "vitest";

import { htmlDocumentText } from "./channel-protocol-assistant";

describe("channel protocol HTML extraction", () => {
    it("keeps visible text, decodes entities, and omits non-content elements", () => {
        const text = htmlDocumentText('<main>API <strong>/v1/models</strong><script src="x">secret()</script><style>.hidden{}</style><template>hidden</template><p>&amp; ready</p></main>');
        expect(text).toBe("API /v1/models & ready");
    });

    it("does not consume text after an unclosed script element", () => {
        expect(htmlDocumentText("<p>before<script>secret()<p>after")).toBe("before");
    });
});
