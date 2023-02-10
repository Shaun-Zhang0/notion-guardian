const axios = require(`axios`);
const extract = require(`extract-zip`);
const fs = require(`fs`);
const {rm, mkdir, unlink} = require(`fs/promises`);
const path = require(`path`);
const config = require("dotenv").config()

const unofficialNotionAPI = `https://www.notion.so/api/v3`;
const {NOTION_TOKEN, NOTION_SPACE_ID, NOTION_USER_ID} = process.env;
const client = axios.create({
    baseURL: unofficialNotionAPI,
    headers: {
        Cookie: `token_v2=${NOTION_TOKEN};`,
        "x-notion-active-user-header": NOTION_USER_ID,
    },
});

if (!NOTION_TOKEN || !NOTION_SPACE_ID || !NOTION_USER_ID) {
    console.error(
        `Environment variable NOTION_TOKEN, NOTION_SPACE_ID or NOTION_USER_ID is missing. Check the README.md for more information.`
    );
    process.exit(1);
}

const sleep = async (seconds) => {
    return new Promise((resolve) => {
        setTimeout(resolve, seconds * 1000);
    });
};

const round = (number) => Math.round(number * 100) / 100;

const exportFromNotion = async (destination, format) => {
    const task = {
        eventName: `exportSpace`,
        request: {
            spaceId: NOTION_SPACE_ID,
            exportOptions: {
                exportType: format,
                timeZone: `Europe/Berlin`,
                locale: `en`,
            },
        },
    };
    const {
        data: {taskId},
    } = await client.post(`enqueueTask`, {task});

    console.log(`Started Export as task [${taskId}].\n`);

    let exportURL;
    while (true) {
        await sleep(2);
        const {
            data: {results: tasks},
        } = await client.post(`getTasks`, {taskIds: [taskId]});
        const task = tasks.find((t) => t.id === taskId);

        if (task.error) {
            console.error(`❌ Export failed with reason: ${task.error}`);
            process.exit(1);
        }

        console.log(`Exported ${task.status.pagesExported} pages.`);

        if (task.state === `success`) {
            exportURL = task.status.exportURL;
            console.log(`\nExport finished.`);
            break;
        }
    }

    const response = await client({
        method: `GET`,
        url: exportURL,
        responseType: `stream`,
    });

    const size = response.headers["content-length"];
    console.log(`Downloading ${round(size / 1000 / 1000)}mb...`);

    const stream = response.data.pipe(fs.createWriteStream(destination));
    await new Promise((resolve, reject) => {
        stream.on(`close`, resolve);
        stream.on(`error`, reject);
    });
};

/**
 * 获取文件名的原始名称
 * @param fileName
 */
function getFileOriginName(fileName) {
    if (fileName.length <= 33) {
        return fileName;
    }
    const hashLength = 33;
    const pattern = /\.{1}[A-Za-z]{1,}$/;
    const _suffixIndex = pattern.exec(fileName).index
    const _suffix = pattern.exec(fileName)[0];
    console.log(fileName.substring(0, _suffixIndex - hashLength) + _suffix)
    return fileName.substring(0, _suffixIndex - hashLength) + _suffix;
}

function travel(dir, callback) {

    fs.readdirSync(dir).forEach((file) => {
        const pathname = path.join(dir, file)

        let newFilePath = ''
        console.log(newFilePath)
        if (fs.statSync(pathname).isDirectory()) {
            newFilePath = path.join(dir, file.slice(0, -33));
            travel(pathname, callback)
        } else {
            newFilePath = path.join(dir, getFileOriginName(file));
            callback(file)
        }
        renameFileOrDirectory(pathname, newFilePath)
    })
}

/**
 * 因为压缩解压后会带hash 此方法用于删除export根目录的hash值
 * 方便github的action可以找到对应的文件夹
 */
function renameExportDirName() {
    const dir = './workspace';
    fs.readdirSync('./workspace').forEach((file) => {
        const pathname = path.join(dir, file)
        const newPathName = path.join(dir, 'export')
        if (fs.statSync(pathname).isDirectory()) {
            renameFileOrDirectory(pathname, newPathName)
        }
    })
}


/**
 * 重命名文件夹或文件
 * @param filePath - 原命名文件路径
 * @param newFilePath - 新命名文件路径
 */
function renameFileOrDirectory(filePath, newFilePath) {
    try {
        fs.renameSync(filePath, newFilePath)
        console.log("Successfully renamed the file!")
    } catch (err) {
        throw err
    }
}

function renameAllFile() {
    renameExportDirName();
    travel('./workspace/export', function (pathname) {
        // console.log(pathname)
    });
}

const run = async () => {
    const workspaceDir = path.join(process.cwd(), `workspace/export`);
    const workspaceZip = path.join(process.cwd(), `workspace.zip`);

    await exportFromNotion(workspaceZip, `markdown`);
    await rm(workspaceDir, {recursive: true, force: true});
    await mkdir(workspaceDir, {recursive: true});
    await extract(workspaceZip, {dir: workspaceDir});
    await unlink(workspaceZip);
    renameAllFile();

    console.log(`✅ Export downloaded and unzipped.`);
};

run();
