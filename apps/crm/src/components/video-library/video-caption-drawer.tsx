// Attach/replace caption tracks for a video asset — Phase 9 Completion T26/T38.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, useToast } from "@repo/ui";
import type { VideoAsset, VideoCaption } from "@repo/types";

import { useAttachVideoCaptions } from "../../hooks/use-video-library";
import { surfaceError } from "../../lib/surface-error";

interface VideoCaptionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  video: VideoAsset | null;
}

export function VideoCaptionDrawer({ open, onOpenChange, video }: VideoCaptionDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const attachCaptions = useAttachVideoCaptions();
  const [captions, setCaptions] = React.useState<VideoCaption[]>([]);

  React.useEffect(() => {
    if (open) setCaptions(video?.captions ?? []);
  }, [open, video]);

  function updateCaption(index: number, patch: Partial<VideoCaption>) {
    setCaptions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCaption() {
    setCaptions((prev) => [...prev, { language: "en", url: "", label: "" }]);
  }

  function removeCaption(index: number) {
    setCaptions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!video) return;
    try {
      await attachCaptions.mutateAsync({ id: video.id, body: { captions } });
      toast({ title: "Captions saved", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save captions");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Captions" description={video?.lessonTitle} size="md" data-testid="video-caption-drawer">
        <DrawerBody className="flex flex-col gap-4">
          {captions.length === 0 ? (
            <p className="text-sm text-fg-muted">No caption tracks yet.</p>
          ) : (
            captions.map((caption, index) => (
              <div key={index} className="flex items-end gap-2 rounded-md border border-border p-2.5">
                <Input
                  label="Language"
                  placeholder="e.g. en"
                  value={caption.language}
                  onChange={(e) => updateCaption(index, { language: e.target.value })}
                  wrapperClassName="w-24"
                  data-testid={`video-caption-language-${index}`}
                />
                <Input
                  label="Label"
                  placeholder="e.g. English"
                  value={caption.label ?? ""}
                  onChange={(e) => updateCaption(index, { label: e.target.value })}
                  wrapperClassName="w-32"
                  data-testid={`video-caption-label-${index}`}
                />
                <Input
                  label="VTT URL"
                  placeholder="https://…"
                  value={caption.url}
                  onChange={(e) => updateCaption(index, { url: e.target.value })}
                  wrapperClassName="flex-1"
                  data-testid={`video-caption-url-${index}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${caption.language} caption`}
                  onClick={() => removeCaption(index)}
                  data-testid={`video-caption-remove-${index}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
          <Button type="button" variant="secondary" size="sm" onClick={addCaption} className="self-start" data-testid="video-caption-add">
            <Plus className="size-4" aria-hidden="true" />
            Add caption track
          </Button>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={attachCaptions.isPending} data-testid="video-caption-save">
            Save captions
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
