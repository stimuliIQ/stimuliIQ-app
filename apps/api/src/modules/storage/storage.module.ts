// apps/api/src/modules/storage/storage.module.ts
//
// Registers the public LocalStorageController (dev "local" storage provider's HTTP surface).
// The controller reads its config from env and is inert unless STORAGE_PROVIDER=local, so it
// is always safe to register. Imported by AppModule.

import { Module } from "@nestjs/common";
import { LocalStorageController } from "./local-storage.controller";

@Module({
  controllers: [LocalStorageController],
})
export class StorageModule {}
