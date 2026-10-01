'use client';

import { FC, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Input } from '@gitroom/react/form/input';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { TikTokMusicSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.music';
import { TikTokLocationSelector } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.location';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

const TikTokSettings: FC<{
  values?: any;
}> = (props) => {
  const { watch, register, setValue, formState } = useSettings();
  const { value, integration } = useIntegration();
  const fetch = useFetch();
  const t = useT();

  // Music and location come from the Business API (v1.3) - the legacy Content
  // Posting API used by the "tiktok" identifier has no such fields.
  const isBusiness = integration?.identifier === 'tiktok-business';

  const isTitle = useMemo(() => {
    return value?.[0]?.image?.some(
      (p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1
    );
  }, [value]);

  const hasMedia = (value?.[0]?.image?.length ?? 0) > 0;
  const isVideo = hasMedia && !isTitle;

  const disclose = watch('disclose');
  const tikTokConsent = watch('tiktokConsent');
  const title = watch('title');
  const autoAddMusic = watch('autoAddMusic');
  const brand_organic_toggle = watch('brand_organic_toggle');
  const brand_content_toggle = watch('brand_content_toggle');
  const content_posting_method = watch('content_posting_method');
  const isUploadMode = content_posting_method === 'UPLOAD';
  const isDirectPost = !isUploadMode;
  const isTikTok = integration?.identifier === 'tiktok';
  const disclosureSelectionMissing =
    isDirectPost &&
    disclose === true &&
    brand_organic_toggle !== true &&
    brand_content_toggle !== true;
  const consentScope = JSON.stringify({
    content: value?.map((post) => post.content),
    media: value?.map((post) => post.image?.map((media) => media.id)),
    title,
    contentPostingMethod: content_posting_method,
    privacyLevel: watch('privacy_level'),
    comment: watch('comment'),
    duet: watch('duet'),
    stitch: watch('stitch'),
    disclose,
    brandOrganic: brand_organic_toggle,
    brandContent: brand_content_toggle,
  });
  const previousConsentScope = useRef<string | null>(null);
  const previousPostingMethod = useRef<string | undefined>(undefined);

  const loadCreatorInfo = useCallback(async () => {
    const response = await fetch(
      `/integrations/${integration?.id}/tiktok/creator-info`
    );
    if (!response.ok) {
      throw new Error('Unable to load TikTok creator information');
    }
    return response.json();
  }, [fetch, integration?.id]);
  const {
    data: creatorInfo,
    error: creatorInfoError,
    isLoading: creatorInfoLoading,
    isValidating: creatorInfoValidating,
  } = useSWR(
    isTikTok && isDirectPost && integration?.id
      ? `tiktok-creator-info-${integration.id}`
      : null,
    loadCreatorInfo,
    { revalidateOnFocus: false, revalidateOnMount: true }
  );

  const selectedMediaId = isVideo ? value?.[0]?.image?.[0]?.id : undefined;
  const loadSelectedMedia = useCallback(async () => {
    const response = await fetch(`/media/${selectedMediaId}/status`);
    if (!response.ok) {
      throw new Error('Unable to load video metadata');
    }
    return response.json();
  }, [fetch, selectedMediaId]);
  const { data: selectedMedia, isLoading: selectedMediaLoading } = useSWR(
    isTikTok && isDirectPost && isVideo && selectedMediaId
      ? `tiktok-video-metadata-${selectedMediaId}`
      : null,
    loadSelectedMedia,
    { revalidateOnFocus: false }
  );

  const privacyOptions: string[] = useMemo(() => {
    const allowed = new Set([
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'FOLLOWER_OF_CREATOR',
      'SELF_ONLY',
    ]);
    return Array.isArray(creatorInfo?.privacyLevelOptions)
      ? creatorInfo.privacyLevelOptions.filter(
          (option: string) =>
            allowed.has(option) &&
            !(brand_content_toggle === true && option === 'SELF_ONLY')
        )
      : [];
  }, [brand_content_toggle, creatorInfo]);

  const creatorInfoValid =
    privacyOptions.length > 0 &&
    typeof creatorInfo?.commentDisabled === 'boolean' &&
    typeof creatorInfo?.duetDisabled === 'boolean' &&
    typeof creatorInfo?.stitchDisabled === 'boolean' &&
    typeof creatorInfo?.maxVideoPostDurationSec === 'number';
  const videoDurationKnown =
    !isVideo ||
    (typeof selectedMedia?.duration === 'number' &&
      Number.isFinite(selectedMedia.duration) &&
      selectedMedia.duration > 0);
  const videoDurationExceeded =
    isVideo &&
    videoDurationKnown &&
    selectedMedia.duration > creatorInfo?.maxVideoPostDurationSec;
  const creatorInfoReady =
    creatorInfoValid &&
    !creatorInfoValidating &&
    videoDurationKnown &&
    !videoDurationExceeded;

  useEffect(() => {
    if (!isTikTok) return;

    if (isUploadMode) {
      // UPLOAD ignores privacy settings, but the shared DTO still requires a
      // valid enum. Keep this hidden compatibility value out of the UI.
      setValue('privacy_level', 'SELF_ONLY', { shouldValidate: false });
    } else if (previousPostingMethod.current === 'UPLOAD') {
      // Returning to Direct Post requires the creator to choose visibility
      // again instead of carrying a value from the hidden Upload setting.
      setValue('privacy_level', '', {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    previousPostingMethod.current = content_posting_method;

    // The save/publish gate in the provider wrapper checks this flag so a
    // failed or pending creator_info request cannot fall back to stale values.
    setValue('tiktokDirectPostReady', isUploadMode || creatorInfoReady, {
      shouldValidate: false,
    });

    if (!isVideo) {
      setValue('duet', false, { shouldValidate: false });
      setValue('stitch', false, { shouldValidate: false });
      setValue('video_made_with_ai', false, { shouldValidate: false });
    }

    if (!creatorInfoValid) return;

    const selectedPrivacy = watch('privacy_level');
    if (selectedPrivacy && !privacyOptions.includes(selectedPrivacy)) {
      setValue('privacy_level', '', {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    if (creatorInfo.commentDisabled) {
      setValue('comment', false, { shouldValidate: false });
    }
    if (creatorInfo.duetDisabled) {
      setValue('duet', false, { shouldValidate: false });
    }
    if (creatorInfo.stitchDisabled) {
      setValue('stitch', false, { shouldValidate: false });
    }
  }, [
    creatorInfo,
    creatorInfoReady,
    creatorInfoValid,
    content_posting_method,
    isTikTok,
    isVideo,
    isUploadMode,
    privacyOptions,
    setValue,
    watch,
  ]);

  useEffect(() => {
    if (!isTikTok) return;
    if (!previousConsentScope.current) {
      previousConsentScope.current = consentScope;
      if (tikTokConsent === true) {
        setValue('tiktokConsent', false, { shouldValidate: false });
      }
      return;
    }
    if (previousConsentScope.current !== consentScope) {
      setValue('tiktokConsent', false, { shouldValidate: false });
    }
    previousConsentScope.current = consentScope;
  }, [consentScope, isTikTok, setValue, tikTokConsent]);

  useEffect(() => {
    if (!isTikTok || disclose !== false) return;
    if (brand_organic_toggle === true) {
      setValue('brand_organic_toggle', false, { shouldValidate: false });
    }
    if (brand_content_toggle === true) {
      setValue('brand_content_toggle', false, { shouldValidate: false });
    }
  }, [brand_content_toggle, brand_organic_toggle, disclose, isTikTok, setValue]);

  // TikTok ignores every setting except the title / content when the posting
  // method is UPLOAD, so we hide them rather than pretend they apply. The fields
  // stay mounted and registered: their values must survive the switch, and
  // TikTokDto still requires most of them at save time.
  const directPostOnly = clsx(isUploadMode && 'invisible h-0 overflow-hidden');

  const tiktokRestrictionNotice = useMemo(() => {
    if (!hasMedia || !isVideo) return null;
    if (!isUploadMode) {
      return t(
        'tiktok_restriction_direct_video',
        'TikTok restriction: For direct post with video, your post content is used as the title. A separate title field is not available.'
      );
    }
    return t(
      'tiktok_restriction_upload_video',
      'TikTok restriction: For upload-only video, TikTok does not accept a title or message. The content will default to "#Postiz" and you can edit it inside the TikTok app before publishing.'
    );
  }, [hasMedia, isUploadMode, isVideo, t]);

  const privacyLabels: Record<string, string> = {
    PUBLIC_TO_EVERYONE: t('public_to_everyone', 'Public to everyone'),
    MUTUAL_FOLLOW_FRIENDS: t('mutual_follow_friends', 'Mutual follow friends'),
    FOLLOWER_OF_CREATOR: t('follower_of_creator', 'Follower of creator'),
    SELF_ONLY: t('self_only', 'Self only'),
  };
  const privacyLevel = privacyOptions.map((option: string) => ({
    value: option,
    label: privacyLabels[option],
  }));
  const contentPostingMethod = [
    {
      value: 'DIRECT_POST',
      label: t(
        'post_content_directly_to_tiktok',
        'Post content directly to TikTok'
      ),
    },
    {
      value: 'UPLOAD',
      label: t(
        'upload_content_to_tiktok_without_posting',
        'Upload content to TikTok without posting it'
      ),
    },
  ];
  const yesNo = [
    {
      value: 'yes',
      label: t('yes', 'Yes'),
    },
    {
      value: 'no',
      label: t('no', 'No'),
    },
  ];

  return (
    <div className="flex flex-col">
      {isTikTok && (
        <div className="mb-[18px] flex items-center gap-[12px] rounded-[10px] border border-tableBorder p-[10px]">
          <img
            src={creatorInfo?.creatorAvatarUrl || integration?.picture || '/no-picture.jpg'}
            alt={t('tiktok_account_avatar', 'TikTok account avatar')}
            className="h-[40px] w-[40px] rounded-full"
          />
          <div className="flex flex-col">
            <div className="text-[12px] text-secondaryText">
              {t('posting_to_tiktok_account', 'Posting to TikTok account')}
            </div>
            <div className="text-[15px] font-[600]">
              {creatorInfo?.creatorNickname || integration?.name}
            </div>
          </div>
        </div>
      )}
      {/*<CheckTikTokValidity picture={props?.values?.[0]?.image?.[0]?.path} />*/}
      {tiktokRestrictionNotice && (
        <div className="bg-tableBorder p-[10px] mb-[18px] rounded-[10px] flex gap-[10px] items-start text-[13px] text-balance">
          <div className="shrink-0 mt-[2px]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>{tiktokRestrictionNotice}</div>
        </div>
      )}
      {isTitle && <Input label="Title" {...register('title')} maxLength={89} />}
      <div className={directPostOnly}>
        <Select
          label={t('label_who_can_see_this_video', 'Who can see this video?')}
          disabled={isUploadMode || creatorInfoLoading || !creatorInfoReady}
          {...register('privacy_level', {
            value: '',
          })}
        >
          <option value="">
            {t('select_privacy_level', 'Select a privacy level')}
          </option>
          {privacyLevel.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        {isDirectPost &&
          isTikTok &&
          (creatorInfoLoading ||
            creatorInfoValidating ||
            creatorInfoError ||
            !privacyLevel.length) && (
            <div
              className="-mt-[14px] mb-[18px] text-[13px] text-red-600"
              role="status"
            >
              {creatorInfoLoading
                ? t(
                    'tiktok_loading_creator_info',
                    'Loading TikTok account settings…'
                  )
                : creatorInfoValidating
                ? t(
                    'tiktok_refreshing_creator_info',
                    'Refreshing TikTok account settings…'
                  )
                : t(
                    'tiktok_creator_info_unavailable',
                    'TikTok account settings could not be loaded. Direct posting is unavailable until they load.'
                  )}
            </div>
          )}
        {isDirectPost && isTikTok && isVideo && !videoDurationKnown && (
          <div
            className="-mt-[14px] mb-[18px] text-[13px] text-red-600"
            role="status"
          >
            {selectedMediaLoading
              ? t('tiktok_loading_video_duration', 'Checking video duration…')
              : t(
                  'tiktok_video_duration_unavailable',
                  'Video duration could not be verified. Direct posting is unavailable until it can be checked.'
                )}
          </div>
        )}
        {isDirectPost && isTikTok && videoDurationExceeded && (
          <div
            className="-mt-[14px] mb-[18px] text-[13px] text-red-600"
            role="alert"
          >
            {t(
              'tiktok_video_exceeds_account_limit',
              `This video is ${Math.ceil(
                selectedMedia.duration
              )} seconds, above this account’s ${
                creatorInfo.maxVideoPostDurationSec
              }-second limit.`
            )}
          </div>
        )}
      </div>
      <div className="text-[14px] mt-[10px] mb-[18px] text-balance">
        {t(
          'choose_upload_without_posting_description',
          `Choose upload without posting if you want to review and edit your content within TikTok's app before publishing.
        This gives you access to TikTok's built-in editing tools and lets you make final adjustments before posting. The additional settings are only available when posting directly to TikTok.`
        )}
      </div>
      <Select
        label={t('label_content_posting_method', 'Content posting method')}
        {...register('content_posting_method', {
          value: 'DIRECT_POST',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {contentPostingMethod.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      {isUploadMode && (
        <div className="-mt-[23px] mb-[23px] text-red-600">
          After posting you fill find a notification inside your Inbox about
          your post (not content studio)
        </div>
      )}
      <div className={clsx('flex flex-col', directPostOnly)}>
        <Select
          label={
            isBusiness
              ? t('label_add_random_music', 'Add random music')
              : t('label_auto_add_music', 'Auto add music')
          }
          disabled={isUploadMode}
          {...register('autoAddMusic', {
            value: 'no',
          })}
        >
          <option value="">{t('select', 'Select')}</option>
          {yesNo.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <div className="text-[14px] mt-[10px] mb-[24px] text-balance">
          {isBusiness
            ? t(
                'tiktok_random_music_only_for_photos',
                "This feature is available only for photos, it adds a random trending track from TikTok's commercial music library."
              )
            : t(
                'this_feature_available_only_for_photos',
                'This feature available only for photos, it will add a default music that\n        you can change later.'
              )}
        </div>
        {isBusiness && (
          <div className="flex flex-col gap-[18px] mb-[24px]">
            {/* Random music replaces a manual choice for photos, so the
                selector is hidden (but stays registered) while it's on. */}
            <div
              className={clsx(
                !isVideo &&
                  autoAddMusic === 'yes' &&
                  'invisible h-0 overflow-hidden'
              )}
            >
              <TikTokMusicSelector
                label={t('tiktok_music_label', 'Music')}
                showVolumes={isVideo}
                {...register('music')}
              />
            </div>
            <TikTokLocationSelector
              label={t('tiktok_location_label', 'Location')}
              {...register('location')}
            />
          </div>
        )}
        <hr className="mb-[15px] border-tableBorder" />
        <div className="text-[14px] mb-[10px]">
          {t('tiktok_video_features', 'Video features')}
        </div>
        {isVideo && (
          <div className="flex gap-[40px]">
            <div
              className={clsx(
                creatorInfo?.duetDisabled && 'pointer-events-none opacity-50'
              )}
            >
              <Checkbox
                variant="hollow"
                label={t('label_duet', 'Allow Duet')}
                {...register('duet', { value: false })}
              />
            </div>
            <div
              className={clsx(
                creatorInfo?.stitchDisabled && 'pointer-events-none opacity-50'
              )}
            >
              <Checkbox
                label={t('label_stitch', 'Allow Stitch')}
                variant="hollow"
                {...register('stitch', { value: false })}
              />
            </div>
            <Checkbox
              label={t('video_made_with_ai', 'Video made with AI')}
              variant="hollow"
              {...register('video_made_with_ai', { value: false })}
            />
          </div>
        )}
        <hr className="my-[15px] mb-[25px] border-tableBorder" />
        <div className="flex flex-col gap-[20px]">
          <div
            className={clsx(
              creatorInfo?.commentDisabled && 'pointer-events-none opacity-50'
            )}
          >
            <Checkbox
              label={t('label_comments', 'Allow Comments')}
              variant="hollow"
              {...register('comment', { value: false })}
            />
          </div>
          <Checkbox
            variant="hollow"
            label={t('label_disclose_video_content', 'Disclose Video Content')}
            disabled={isUploadMode}
            {...register('disclose', {
              value: false,
            })}
          />
          {disclose && (
            <div className="bg-tableBorder p-[10px] mt-[10px] rounded-[10px] flex gap-[20px] items-center">
              <div>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                    fill="white"
                  />
                </svg>
              </div>
              <div>
                {disclosureSelectionMissing
                  ? t(
                      'tiktok_disclosure_selection_required',
                      'Choose Your brand, Branded content, or both to continue.'
                    )
                  : brand_content_toggle
                    ? t(
                        'tiktok_paid_partnership_label',
                        'Your video will be labeled “Paid partnership”.'
                      )
                    : t(
                        'tiktok_promotional_content_label',
                        'Your video will be labeled “Promotional content”.'
                      )}
                <br />
                {t(
                  'this_cannot_be_changed_once_posted',
                  'This cannot be changed once your video is posted.'
                )}
              </div>
            </div>
          )}
          <div className="text-[14px] my-[10px] text-balance">
            {t(
              'turn_on_to_disclose_video_promotes',
              'Turn on to disclose that this video promotes goods or services in\n          exchange for something of value. You video could promote yourself, a\n          third party, or both.'
            )}
          </div>
        </div>
        <div
          className={clsx(
            !disclose && 'invisible h-0 overflow-hidden',
            'mt-[20px]'
          )}
        >
          <Checkbox
            variant="hollow"
            label={t('label_your_brand', 'Your brand')}
            disabled={isUploadMode}
            {...register('brand_organic_toggle', {
              value: false,
            })}
          />
          <div className="text-balance my-[10px] text-[14px]">
            {t(
              'you_are_promoting_yourself',
              'You are promoting yourself or your own brand.'
            )}
            <br />
            {t(
              'tiktok_promotional_content_description',
              'TikTok will label this “Promotional content”.'
            )}
          </div>
          <Checkbox
            variant="hollow"
            label={t('label_branded_content', 'Branded content')}
            disabled={isUploadMode}
            {...register('brand_content_toggle', {
              value: false,
            })}
          />
          <div className="text-balance my-[10px] text-[14px]">
            {t(
              'you_are_promoting_another_brand',
              'You are promoting another brand or a third party.'
            )}
            <br />
            {t(
              'tiktok_paid_partnership_description',
              'TikTok will label this “Paid partnership”.'
            )}
          </div>
        </div>
      </div>
      {isTikTok && (
        <div className="mt-[18px] flex flex-col gap-[8px]">
          <Checkbox
            variant="hollow"
            label={t(
              'tiktok_consent_checkbox',
              'I consent to sending this content to TikTok.'
            )}
            {...register('tiktokConsent', { value: false })}
          />
          <div className="text-[14px] text-balance">
            {t(
              'by_posting_you_agree_to_tiktoks',
              "By posting, you agree to TikTok's"
            )}{' '}
            {brand_content_toggle && (
              <>
                <a
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#B69DEC] hover:underline"
                  href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                >
                  {t('branded_content_policy', 'Branded Content Policy')}
                </a>{' '}
                {t('and', 'and')}{' '}
              </>
            )}
            <a
              target="_blank"
              rel="noreferrer"
              className="text-[#B69DEC] hover:underline"
              href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
            >
              {t('music_usage_confirmation', 'Music Usage Confirmation')}
            </a>
            .
          </div>
          {formState.errors.tiktokConsent?.message && (
            <div className="text-[13px] text-red-600" role="alert">
              {String(formState.errors.tiktokConsent.message)}
            </div>
          )}
          {formState.errors.tiktokDirectPostReady?.message && (
            <div className="text-[13px] text-red-600" role="alert">
              {String(formState.errors.tiktokDirectPostReady.message)}
            </div>
          )}
          {isDirectPost && isTikTok && creatorInfoValid && (
            <div className="text-[13px] text-balance">
              {t(
                'tiktok_max_video_duration',
                `This account accepts videos up to ${
                  creatorInfo.maxVideoPostDurationSec
                } seconds${
                  videoDurationKnown && isVideo
                    ? `; selected video: ${Math.ceil(
                        selectedMedia.duration
                      )} seconds`
                    : ''
                }.`
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokDto,
  maximumCharacters: 2000,
});
