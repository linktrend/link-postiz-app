jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({
    MediaService: class MediaService {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class SubscriptionService {} })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));
jest.mock('@gitroom/nestjs-libraries/upload/r2.uploader', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({
  streamUploadOptions: jest.fn(() => ({})),
}));

import { MediaController } from './media.controller';

describe('MediaController.uploadServer', () => {
  it('uses the upload processing path so MP4 duration is measured and saved', async () => {
    const media = { id: 'media-id', duration: 6 };
    const mediaService = {
      saveUploadedFile: jest.fn().mockResolvedValue(media),
    };
    const controller = new MediaController(mediaService as any, {} as any);
    const org = { id: 'organization-id' } as any;
    const file = {
      filename: 'stored-video.mp4',
      path: 'https://cdn.example.test/uploads/stored-video.mp4',
      originalname: 'video.mp4',
    } as Express.Multer.File;

    await expect(controller.uploadServer(org, file)).resolves.toBe(media);
    expect(mediaService.saveUploadedFile).toHaveBeenCalledWith(
      org.id,
      file.filename,
      file.path,
      file.originalname
    );
  });
});
