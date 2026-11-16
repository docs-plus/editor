// A generic-feed Provider that refuses any channel file without a valid
// detached Ed25519 signature (<channel>.yml.sig, base64).
//
// It verifies the exact string it then parses: both come from the one
// httpRequest result, so nothing is fetched between the check and the parse.
// The public key is built in (build.ts --define); the private key never
// leaves the CI job that signs the manifests.
import { createPublicKey, verify } from "node:crypto";

import type { UpdateInfo } from "builder-util-runtime";
import type { AppUpdater } from "electron-updater";
import {
  Provider,
  type ProviderRuntimeOptions,
  parseUpdateInfo,
  resolveFiles,
} from "electron-updater/out/providers/Provider";
import type { ResolvedUpdateFileInfo } from "electron-updater/out/types";
import { getChannelFilename, newUrlFromBase } from "electron-updater/out/util";

import { log } from "./probe-context";

export interface SignedFeedOptions {
  provider: "custom";
  url: string;
  publicKeyPem: string;
  channel?: string | null;
}

export class SignedGenericProvider extends Provider<UpdateInfo> {
  private readonly baseUrl: URL;

  constructor(
    private readonly configuration: SignedFeedOptions,
    private readonly updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    const base = new URL(configuration.url);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    this.baseUrl = base;
  }

  private get channel() {
    const result = this.updater.channel || this.configuration.channel;
    return result == null
      ? this.getDefaultChannelName()
      : this.getCustomChannelName(result);
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const channelFile = getChannelFilename(this.channel);
    const noCache = (this.updater as unknown as { isAddNoCacheQuery: boolean })
      .isAddNoCacheQuery;
    const channelUrl = newUrlFromBase(channelFile, this.baseUrl, noCache);
    const sigUrl = newUrlFromBase(`${channelFile}.sig`, this.baseUrl, noCache);
    const raw = await this.httpRequest(channelUrl);
    const sig = await this.httpRequest(sigUrl);
    if (raw == null || sig == null) {
      throw new Error(`manifest-signature: missing ${channelFile} or its .sig`);
    }
    const ok = verify(
      null,
      Buffer.from(raw, "utf8"),
      createPublicKey(this.configuration.publicKeyPem),
      Buffer.from(sig.trim(), "base64"),
    );
    log(`signed-provider ${channelFile} signature valid=${ok}`);
    if (!ok) {
      throw new Error(
        `manifest-signature: ${channelFile} failed Ed25519 verification, refusing it`,
      );
    }
    return parseUpdateInfo(raw, channelFile, channelUrl);
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return resolveFiles(updateInfo, this.baseUrl);
  }
}
