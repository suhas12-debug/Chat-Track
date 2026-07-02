const fs = require('fs');
const filePath = require('path').join(__dirname, 'export.js');
let content = fs.readFileSync(filePath, 'utf-8');

// ========================================
// FIX 1: toPdf template — AI name + ChatTrack + line + content (no prompt section)
// ========================================
// Find the toPdf fullHtml block (first occurrence)
const toPdfAnchor = "const fullHtml = `";
const toPdfStart = content.indexOf(toPdfAnchor);
const toPdfEnd = content.indexOf("`;", toPdfStart) + 2; // end of template literal

const newToPdfTemplate = `const fullHtml = \`
            <style>
                * { -webkit-print-color-adjust: exact !important; box-sizing: border-box !important; }
                body { 
                    padding: 30px 35px; color: #1a1a1a !important; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.7; background: #fff !important; margin: 0;
                    font-size: 14px;
                }
                #pdf-root, #pdf-root *:not(img) { 
                    background-color: transparent !important; 
                    color: #1a1a1a !important;
                    max-width: 100% !important;
                }
                #pdf-root img {
                    display: block !important;
                    max-width: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    margin: 15px 0 !important;
                    border-radius: 6px !important;
                }
                .platform-name {
                    font-size: 0.65rem;
                    font-weight: 700;
                    color: #888;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    margin-bottom: 4px;
                }
                .doc-header { 
                    font-size: 1.8rem;
                    font-weight: 800;
                    color: #111;
                    margin-bottom: 0;
                    line-height: 1.3;
                }
                .header-divider {
                    border: none;
                    border-top: 2px solid #333;
                    margin: 10px 0 24px 0;
                }
                pre, blockquote, img, li, table {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                pre { 
                    background: #f4f4f4 !important; border-radius: 6px; padding: 15px; 
                    margin: 15px 0; border: 1px solid #ddd;
                    overflow-x: auto;
                    white-space: pre-wrap !important;
                    word-wrap: break-word !important;
                    font-size: 0.9rem !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                code { font-family: monospace; white-space: pre-wrap !important; }
                [class*="code-block"]:not(pre):not(code),
                [class*="code-container"]:not(pre):not(code) {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                [class*="code-block"] > *:first-child:not(pre):not(code),
                [class*="code-container"] > *:first-child:not(pre):not(code) {
                    display: none !important;
                }
                h1, h2, h3, h4, h5, h6 { page-break-after: avoid !important; break-after: avoid !important; }
                p { orphans: 3; widows: 3; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: #f8f8f8 !important; }
                blockquote { 
                    margin: 20px 0; padding: 10px 20px; color: #555 !important; 
                    border-left: 4px solid #bb86fc; background: #f9f9f9 !important;
                }
                img { 
                    max-width: 100% !important; 
                    height: auto !important; 
                    display: block; 
                    margin: 15px 0; 
                    border-radius: 4px;
                }
            </style>
            <div class="platform-name">AI Conversation</div>
            <div class="doc-header">ChatTrack</div>
            <hr class="header-divider">
            <div id="pdf-root">\${cleanBodyHtml}</div>
        \``;

content = content.substring(0, toPdfStart) + newToPdfTemplate + content.substring(toPdfEnd);

// ========================================
// FIX 2: exportPromptAnswer template — AI name + ChatTrack + line + prompt with purple bar + AI response
// ========================================
// Find the second fullHtml occurrence (exportPromptAnswer)
const secondAnchor = "const fullHtml = `";
const secondStart = content.indexOf(secondAnchor, toPdfStart + newToPdfTemplate.length);
const secondEnd = content.indexOf("        `;", secondStart) + 10;

const newPromptTemplate = `const fullHtml = \`
            <style>
                * { -webkit-print-color-adjust: exact !important; box-sizing: border-box !important; }
                body { 
                    padding: 30px 35px; color: #1a1a1a !important; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.7; background: #fff !important; margin: 0;
                    font-size: 14px;
                }
                #pdf-root, #pdf-root *:not(img) { 
                    background-color: transparent !important; 
                    color: #1a1a1a !important;
                    max-width: 100% !important;
                }
                #pdf-root img {
                    display: block !important;
                    max-width: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    margin: 15px 0 !important;
                    border-radius: 6px !important;
                }
                /* Top branding */
                .platform-name {
                    font-size: 0.65rem;
                    font-weight: 700;
                    color: #888;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    margin-bottom: 4px;
                }
                .doc-header { 
                    font-size: 1.8rem;
                    font-weight: 800;
                    color: #111;
                    margin-bottom: 0;
                    line-height: 1.3;
                }
                .header-divider {
                    border: none;
                    border-top: 2px solid #333;
                    margin: 10px 0 24px 0;
                }
                /* Prompt section with purple left bar */
                .prompt-section {
                    border-left: 4px solid #bb86fc;
                    padding: 8px 16px;
                    margin-bottom: 24px;
                }
                .prompt-label {
                    font-size: 0.6rem;
                    font-weight: 800;
                    color: #555;
                    text-transform: uppercase;
                    letter-spacing: 1.2px;
                    margin-bottom: 6px;
                }
                .prompt-text {
                    font-size: 1rem;
                    line-height: 1.6;
                    white-space: pre-wrap !important;
                    word-break: break-word !important;
                    color: #1a1a1a;
                }
                /* AI Response section */
                .answer-label {
                    font-size: 0.6rem;
                    font-weight: 800;
                    color: #555;
                    text-transform: uppercase;
                    letter-spacing: 1.2px;
                    margin-bottom: 10px;
                }
                .answer-section { padding: 0; }
                .answer-content { font-size: 0.94rem; line-height: 1.75; }
                .answer-content *:not(img) { max-width: 100% !important; }
                /* Headings */
                h1 { font-size: 1.5rem; font-weight: 700; margin: 20px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 6px; page-break-after: avoid; }
                h2 { font-size: 1.25rem; font-weight: 700; margin: 18px 0 8px; page-break-after: avoid; }
                h3 { font-size: 1.1rem; font-weight: 600; margin: 14px 0 6px; page-break-after: avoid; }
                h4, h5, h6 { font-size: 1rem; font-weight: 600; margin: 12px 0 5px; page-break-after: avoid; }
                p { margin: 0 0 10px; page-break-inside: avoid; orphans: 3; widows: 3; }
                /* Code */
                code {
                    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
                    font-size: 0.875em;
                    background: #f0f0f0 !important;
                    color: #c7254e !important;
                    padding: 1px 5px !important;
                    border-radius: 3px !important;
                    border: none !important;
                    display: inline !important;
                    white-space: nowrap !important;
                }
                pre {
                    background: #f6f8fa !important;
                    border: 1px solid #e1e4e8 !important;
                    border-radius: 6px !important;
                    padding: 14px 16px !important;
                    margin: 12px 0 !important;
                    overflow-x: auto;
                    white-space: pre-wrap !important;
                    word-wrap: break-word !important;
                    font-size: 0.85rem !important;
                    line-height: 1.55 !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                pre code {
                    background: transparent !important;
                    color: #1a1a1a !important;
                    padding: 0 !important;
                    border: none !important;
                    display: block !important;
                    white-space: pre-wrap !important;
                    font-size: inherit !important;
                }
                [class*="code-block"]:not(pre):not(code),
                [class*="code-container"]:not(pre):not(code) {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                [class*="code-block"] > *:first-child:not(pre):not(code),
                [class*="code-container"] > *:first-child:not(pre):not(code) {
                    display: none !important;
                }
                /* Lists */
                ul, ol { margin: 8px 0 12px 0; padding-left: 24px; }
                li { margin-bottom: 4px; page-break-inside: avoid; }
                li > ul, li > ol { margin: 4px 0 4px 0; }
                /* Tables */
                table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.9rem; page-break-inside: avoid; }
                th { background: #f3f4f6 !important; font-weight: 600; text-align: left; }
                th, td { border: 1px solid #d1d5db !important; padding: 8px 12px; vertical-align: top; }
                tr:nth-child(even) td { background: #fafafa !important; }
                /* Blockquote */
                blockquote { 
                    margin: 14px 0; padding: 10px 16px; 
                    border-left: 4px solid #bb86fc !important; 
                    background: #faf8ff !important;
                    border-radius: 0 6px 6px 0;
                    font-style: italic;
                    color: #444 !important;
                }
                /* Images */
                img { 
                    max-width: 100% !important; height: auto !important; 
                    display: block !important; margin: 16px auto !important; 
                    border-radius: 6px; page-break-inside: avoid !important;
                }
                hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
                strong, b { font-weight: 700; }
                pre, blockquote, table, figure { page-break-inside: avoid !important; break-inside: avoid !important; }
            </style>
            <div id="pdf-root">
                <div class="platform-name">\${this.escapeHtmlForPdf(platform)}</div>
                <div class="doc-header">ChatTrack</div>
                <hr class="header-divider">
                <div class="prompt-section">
                    <div class="prompt-label">Your Prompt</div>
                    <div class="prompt-text">\${this.escapeHtmlForPdf(prompt)}</div>
                </div>
                \${hasMeaningfulContent ? \\\`
                <div class="answer-section">
                    <div class="answer-label">AI Response</div>
                    <div class="answer-content">\${cleanAnswerHtml}</div>
                </div>
                \\\` : '<div style="color: #999; font-style: italic; padding: 20px; text-align: center;">No answer captured for this prompt.</div>'}
            </div>
        \``;

content = content.substring(0, secondStart) + newPromptTemplate + content.substring(secondEnd);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Both PDF templates updated successfully!');
