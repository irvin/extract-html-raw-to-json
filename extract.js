const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const batchSize = 20; // 每批處理的檔案數量

// 從命令列參數取得目錄路徑
const dir = process.argv[2]; // 第三個參數是目錄路徑

if (!dir) {
  console.error('請提供目錄路徑作為命令列參數');
  process.exit(1);
}

// 讀取 HTML 文件，提取 JSON-LD 資料，存成 JSON 檔案
async function parseFileSavetoJson(fileName, index, total) {
  console.log(`(${index + 1}/${total}) read file: ${fileName}`);

  try {
  const htmlContent = await fs.readFile(fileName, 'utf8');
  const $ = cheerio.load(htmlContent);

  // 提取 <script type="application/ld+json"> 標籤的內容
  const jsonLdScript = $('script[type="application/ld+json"]').html();
  const jsonLdData = JSON.parse(jsonLdScript);

  if (!jsonLdData) return;

  let res = {
    '@id': jsonLdData.mainEntityOfPage['@id'],
    articleSection: jsonLdData.articleSection,
    description: jsonLdData.description.trim(),
    dateModified: jsonLdData.dateModified,
    datePublished: jsonLdData.datePublished,
    headline: jsonLdData.headline,
    keywords: jsonLdData.keywords
  };

  // 提取 <script id="fusion-metadata" type="application/javascript"> 標籤的內容
  let fuMetadata = $('script[id="fusion-metadata"]').html();

  function extractRawHtmlContent(rawHtml) {
    const rawHtmlRegex = /"type"\s*:\s*"raw_html"[^}]*"content"\s*:\s*"([^"]*)"/g;
    let matches;
    const contents = [];

    while ((matches = rawHtmlRegex.exec(rawHtml)) !== null) {
      contents.push(matches[1]);
    }

    return contents;
  }

  // 清除 raw content 中的 html tag
  function removeHtmlTags(array) {
    const htmlTagRegex = /<[^>]*>/g;
    return array.map(item => item.replace(htmlTagRegex, ''));
  }

  res.raw_content = removeHtmlTags(extractRawHtmlContent(fuMetadata));

  const jsonString = JSON.stringify(res, null, 2);

  var fileSave = fileName.replace('html', 'json');
  await fs.writeFile(fileSave, jsonString);
  console.log(`(${index + 1}/${total}) Successfully wrote: ${fileSave}`);
  } catch (err) {
    console.error(`Error processing file ${fileName}`, err);
  }
}

// 遍歷目錄列出所有 .html 檔案
async function getHtmlFiles(dir, fileList = []) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await getHtmlFiles(filePath, fileList);
    } else if (path.extname(file) === '.html') {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// 將檔案分批處理
async function processFilesInBatches(files, batchSize) {
  const totalFiles = files.length;
  for (let i = 0; i < totalFiles; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map((filePath, index) => parseFileSavetoJson(filePath, i + index, totalFiles)));
  }
}

(async function() {
  try {
    const htmlFiles = await getHtmlFiles(dir);
    await processFilesInBatches(htmlFiles, batchSize);
  } catch (err) {
    console.error('Error processing directory', err);
  }
})();