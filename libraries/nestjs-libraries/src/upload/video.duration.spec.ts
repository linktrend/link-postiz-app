import { Readable } from 'stream';
import { getVideoDuration } from './video.duration';

function box(type: string, body: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + header.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function videoOnlyMp4(durationSeconds: number) {
  const movieHeader = Buffer.alloc(100);
  movieHeader.writeUInt32BE(1000, 12);
  movieHeader.writeUInt32BE(durationSeconds * 1000, 16);
  const fileType = box('ftyp', Buffer.from('isom\0\0\0\0isommp42'));
  const mediaData = box('mdat', Buffer.alloc(2048));
  const movie = box('moov', box('mvhd', movieHeader));
  return Buffer.concat([fileType, mediaData, movie]);
}

describe('getVideoDuration', () => {
  it('reads duration for a silent MP4 when moov follows mdat', async () => {
    const stream = Readable.from([videoOnlyMp4(17)]);

    await expect(getVideoDuration(stream)).resolves.toBe(17);
    expect(stream.destroyed).toBe(true);
  });

  it('returns null when the stream does not contain an MP4 movie header', async () => {
    await expect(
      getVideoDuration(Readable.from([Buffer.from('not an mp4')]))
    ).resolves.toBeNull();
  });
});
