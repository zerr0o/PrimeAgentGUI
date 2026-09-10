export default function studioImages(pi) {
  pi.on('before_agent_start', async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nStudio can display existing project images inline. Use Markdown ![caption](project-relative/path.png) for PNG, JPEG, GIF or WebP files that exist inside the current project. Do not embed base64 or use localhost/file URLs. The image is read from its original location, not archived; removed files display an unavailable placeholder.`,
  }));
}
