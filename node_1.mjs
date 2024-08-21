import path from 'path';
import fs from 'node:fs'
import process from "node:process";
import cors from 'cors';
import Enqueue from 'express-enqueue';
import compression from 'compression';
import * as dotenv from 'dotenv';
import express from 'express';

/* eslint-disable no-console */
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { kadDHT, removePublicAddressesMapper } from '@libp2p/kad-dht'
import { mplex } from '@libp2p/mplex'
import { tcp } from '@libp2p/tcp'
import { createLibp2p } from 'libp2p'
import bootstrappers from './bootstrappers.js'
import {createEd25519PeerId, exportToProtobuf, createFromProtobuf} from '@libp2p/peer-id-factory'
import { autoNAT } from '@libp2p/autonat'

const fileNamePeerId = '/peerId_1.proto'
let pathNode = ''
const __dirname = process.cwd();
const isRead = true
const writePeerId = async (name) => {
    const peerId = await createEd25519PeerId()
    fs.writeFileSync(__dirname + name, exportToProtobuf(peerId))
    return peerId
}

const readPeerId = async (name) => {
    const buffer = fs.readFileSync(__dirname + name)
    return createFromProtobuf(buffer)
}

const peerId = fs.existsSync(__dirname + fileNamePeerId) && isRead ? await readPeerId(fileNamePeerId) :await writePeerId(fileNamePeerId)

dotenv.config();

const port = process.env.PORT
    ? process.env.PORT
    : 4817;

let whitelist = ['*']

let app = express();

app.use(compression());
app.use(express.json());

const queue = new Enqueue({
    concurrentWorkers: 4,
    maxSize: 200,
    timeout: 30000
});

const corsOptions = {
    origin: function (origin, callback) {
        if (whitelist.indexOf(origin) !== -1 || whitelist.includes('*')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

app.use(await cors({credentials: true}));
app.use(queue.getMiddleware());

const createNode = async () => {
    const node = await createLibp2p({
        peerId,
        addresses: {
            listen: [`/ip4/0.0.0.0/tcp/${process.env.PORT? '443': port + 1}`],
            announce: [`/dns4/0.0.0.0/tcp/${process.env.PORT? '443': port + 1}`]
        },
        transports: [tcp()],
        streamMuxers: [yamux(), mplex()],
        connectionEncryption: [noise()],
        peerDiscovery: [
            bootstrap({
                list: bootstrappers
            })
        ],
        services: {
            kadDHT: kadDHT({
                protocol: '/org/kad/1.0.0',
                clientMode: false
            }),
            identify: identify(),
            autoNAT: autoNAT()
        }
    })

    const peerConfig = {
        peerId: node.peerId.toString(),
        ma: node.getMultiaddrs()
    }

    console.log('Listening on:', peerConfig)

    peerConfig.ma.forEach((ma) => {
        pathNode = ma.toString()
    })

    node.addEventListener('peer:connect', (evt) => {
        const peerId = evt.detail
        console.log('Connection established to:', peerId.toString()) // Emitted when a peer has been found
    })

    node.addEventListener('peer:discovery', (evt) => {
        const peerInfo = evt.detail

        console.log('Discovered:', peerInfo.id.toString())
    })

    return node
}

async function main () {
    app.use(express.static('public'))

    const node = await createNode()

    app.get(`/env.json`, async (req, res) => {
        res.status(200).sendFile(path.join(__dirname, 'env.json'))
    })

    app.get(`/env.mjs`, async (req, res) => {
        res.status(200).sendFile(path.join(__dirname, 'env.mjs'))
    })

    app.get(`/*`, async (req, res) => {
        const html = `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>org browser relay</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes" />
    <meta
            name="description"
            content="">
    <meta property="og:site_name" content="markdown" />
    <meta property="og:locale" content="ru_RU" />
    <meta property="og:type" content="contract" />
    <meta property="og:title" content="markdown" />
    <meta property="og:description" content="markdown" />
    <meta property="og:image" content="https://i.imgur.com/pSrPUkJ.jpg" />
    <meta property="og:image:width" content="537" />
    <meta property="og:image:height" content="240" />
    <link rel="shortcut icon"
          href="data:image/png;base64, AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbbv+DGW3/mRlt/5kZbf+ZGq6/hIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGa3/ohkt/7/Zbj//2S3/v9lt/6WAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGm5/iRlt/74Zbj//2W4//9luP//Zbf++mi4/i4gIPciGhr24hsb9uwbG/bsGhr24CEh9xoAAAAAAAAAAAAAAABnuP5mZLf+/2W4//9luP//Zbj//2S3/v9muP5yGBj2rhMT9v8TE/b/ExP2/xMT9f8YGPWkAAAAAAAAAAAAAAAAb7z/BGW3/tZluP//Zbj//2W4//9lt/7gJzH3ShMT9f8TE/b/ExP2/xMT9v8TE/b/ExP1/CAg9joAAAAAAAAAAAAAAABmuP5GZLf+6GS3/uhkt/7oZbf+UhgY9YQSEvX/ExP2/xMT9v8TE/b/ExP2/xIS9f8aGvZ8AAAAAD4++gQgIPZ6IiL2hiIi9oYgIPZ8KCj5BAAAAAAtLfgUFBT17BMT9v8TE/b/ExP2/xMT9v8VFfXoLCz4DgAAAAAaGvZqEhL1/xMT9v8TE/b/EhL1/xsb9nIAAAAAAAAAABwc9m4SEvX/ExP2/xMT9v8SEvX/HR32ZAAAAAAnJ/gSFRX16hMT9v8TE/b/ExP2/xMT9v8UFPXuJyf4Fp2xlAKNnqUYLC/mfhYW83ATE/VuFxf1aDc3+gIAAAAAGBj1fhIS9f8TE/b/ExP2/xMT9v8TE/b/ExP1/xkZ9YaGn3yIhZ57/4Wee/+Gn3yKAAAAAAAAAAAAAAAAAAAAACMj9zYTE/X8ExP2/xMT9v8TE/b/ExP2/xMT9f9JUshihZ57+IaffP+Gn3z/hZ579oigfiYAAAAAAAAAAAAAAAAAAAAAGBj1oBIS9f8TE/b/ExP2/xMT9f8YGPWmiKB+PIWee/+Gn3z/hp98/4Wee/+HoH06AAAAAAAAAAAAAAAAAAAAACUl9xgVFfXOExP11BMT9dQUFPXQJib3HgAAAACGn3ymhp98/4affP+Gn3ymAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiKB+EIihf0CIoX9AiKB+EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAP//AADg/wAA4MMAAOCBAADggQAA8QEAAOeBAADDwwAAgf8AAIAPAACBDwAAgQ8AAMMPAAD//wAA//8AAA=="
          type="image/png">
    <style>
      .body {
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        margin: auto;
      }
      .body img {
        align-self: center;
      }

      #addr {
        display: flex;
        flex-direction: row;
        gap: 24px;
        justify-content: center;
        align-items: center;
      }

      p {
        background: #AFAFAF;
        padding: 4px;
        border-radius: 2px;
        width: max-content;
      }
    </style>
  </head>
  <body>
  <div class="body">
    <br>
    <img src="./newkind-icon-512-maskable.png" alt="org Logo" width="128">
    <h2>This is a relay</h2>
    <div id="addr">You can add this bootstrap list with the address <p>${pathNode}</p></div>
  </div>
  </body>
</html>
`;
        res.status(200).send(html);
        // res.status(200).sendFile(path.join(__dirname, '/index.html'));
    });

    app.post(`/*`, async (req, res) => {
        console.log('==== POST ====', req.path);
    });

    app.use(queue.getErrorMiddleware());

    app.listen(port, () => {
        console.log('pid: ', process.pid);
        console.log('listening on http://localhost:' + port);
    });
}

main()
