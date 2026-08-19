
// This file helps Vercel understand how to handle client-side routing
export default function handler(req, res) {
  // Serve the index.html for all routes
  const url = req.url;
  
  // Check if the request is for an asset (has a file extension)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(url);
  
  if (!hasExtension) {
    // For routes without file extensions, serve the index.html
    return res.status(200).send(require('fs').readFileSync('index.html', 'utf8'));
  }
  
  // For other requests (assets), let Vercel handle them normally
  return res.status(404).send('Not found');
}
