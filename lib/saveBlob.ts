/**
 * Save a Blob as a file, reliably.
 *
 * The pattern used across the app — create a link, click it, revoke the URL
 * on the next line — races the download: Electron and Firefox can cancel it
 * because the URL is gone before the save starts, and Firefox ignores a
 * click on a link that is not in the document. This keeps the link in the
 * page for the click and releases the URL only after the save has begun.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
}
