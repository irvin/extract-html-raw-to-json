const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');


// 讀取 HTML 文件

function parseFileSavetoJson(fileName) {
console.log('read file', fileName);

const htmlContent = fs.readFileSync(fileName, 'utf8');
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
}

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
fs.writeFile(fileSave, jsonString, (err) => {
  if (err) {
    console.error('Error writing file', err);
  } else {
    console.log('Successfully wrote file', fileSave);
  }
});
}

// 遍歷目錄列出所有 .html 檔案
function getHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getHtmlFiles(filePath, fileList);
    } else if (path.extname(file) === '.html') {
      fileList.push(filePath);
    }
  });
  return fileList;
}

(function() {
  const dir = 'test_path/'; // 替換成實際的目錄路徑
  const htmlFiles = getHtmlFiles(dir);
  console.log('htmlFiles', htmlFiles);
  htmlFiles.forEach(filePath => {
    parseFileSavetoJson(filePath);
  });
})();
