import { getAuth } from "@clerk/fastify";
import { uploadMerchantAsset } from "../lib/uploadMerchantAsset.js";

export async function merchantAssetsRoutes(fastify) {
  fastify.post("/api/merchant/assets/upload", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated) {
        return reply.code(401).send({ ok: false, message: "Unauthorized" });
      }

      // curl -X POST http://localhost:3000/api/merchant/assets/upload \
      //   -H "Authorization: Bearer <CLERK_TOKEN>" \
      //   -F "kind=logo" \
      //   -F "file=@logo.png"
      const file = await request.file();
      const kind = file?.fields?.kind?.value;

      if (!file || !kind) {
        return reply
          .code(400)
          .send({
            ok: false,
            message: "Invalid payload: provide kind=logo|hero and file",
          });
      }

      const buffer = await file.toBuffer();
      const url = await uploadMerchantAsset({
        merchantId: userId,
        kind,
        buffer,
        contentType: file.mimetype,
      });

      return reply.send({ ok: true, kind, url });
    } catch (err) {
      return reply
        .code(400)
        .send({ ok: false, message: err.message });
    }
  });
}
