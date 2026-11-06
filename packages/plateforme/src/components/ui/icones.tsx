// Icônes de la plateforme : famille unique Phosphor, graisse « regular » (CDC §10, §9 Iconographie).
// Tout écran importe ses icônes d'ici, jamais de la bibliothèque directement (garde ESLint
// 'no-restricted-imports') : une seule famille, un seul réglage.
//
// Chaque icône est décorative par défaut (aria-hidden), comme l'étaient les icônes Lucide :
// sans aria-label, aria-labelledby, alt ni role, un lecteur d'écran l'ignore. Taille par défaut
// 24 px, surchargée par les classes h-* w-* comme avant.
import { forwardRef } from 'react';
import type { Icon, IconProps } from '@phosphor-icons/react';
import {
  ArrowClockwiseIcon as PhArrowClockwise,
  ArrowCounterClockwiseIcon as PhArrowCounterClockwise,
  ArrowLeftIcon as PhArrowLeft,
  ArrowRightIcon as PhArrowRight,
  BellIcon as PhBell,
  BellRingingIcon as PhBellRinging,
  BookOpenIcon as PhBookOpen,
  BuildingsIcon as PhBuildings,
  CalendarDotsIcon as PhCalendarDots,
  CalendarPlusIcon as PhCalendarPlus,
  CalendarXIcon as PhCalendarX,
  CaretDownIcon as PhCaretDown,
  CaretLeftIcon as PhCaretLeft,
  CaretRightIcon as PhCaretRight,
  CaretUpDownIcon as PhCaretUpDown,
  CaretUpIcon as PhCaretUp,
  ChartBarIcon as PhChartBar,
  CheckCircleIcon as PhCheckCircle,
  CheckIcon as PhCheck,
  ChecksIcon as PhChecks,
  ChefHatIcon as PhChefHat,
  CircleNotchIcon as PhCircleNotch,
  ClipboardTextIcon as PhClipboardText,
  ClockCounterClockwiseIcon as PhClockCounterClockwise,
  ClockIcon as PhClock,
  ColumnsIcon as PhColumns,
  CopyIcon as PhCopy,
  CreditCardIcon as PhCreditCard,
  CurrencyEurIcon as PhCurrencyEur,
  DoorOpenIcon as PhDoorOpen,
  DotsThreeIcon as PhDotsThree,
  DownloadSimpleIcon as PhDownloadSimple,
  EnvelopeSimpleIcon as PhEnvelopeSimple,
  EyeIcon as PhEye,
  FileDashedIcon as PhFileDashed,
  FilePlusIcon as PhFilePlus,
  FileTextIcon as PhFileText,
  FileXIcon as PhFileX,
  FlaskIcon as PhFlask,
  FloppyDiskIcon as PhFloppyDisk,
  FlowArrowIcon as PhFlowArrow,
  ForkKnifeIcon as PhForkKnife,
  GearIcon as PhGear,
  HandHeartIcon as PhHandHeart,
  HandshakeIcon as PhHandshake,
  HeartIcon as PhHeart,
  IdentificationCardIcon as PhIdentificationCard,
  ImageIcon as PhImage,
  InfoIcon as PhInfo,
  KeyIcon as PhKey,
  LeafIcon as PhLeaf,
  LightningIcon as PhLightning,
  ListIcon as PhList,
  LockSimpleIcon as PhLockSimple,
  MagnifyingGlassIcon as PhMagnifyingGlass,
  MapPinIcon as PhMapPin,
  MinusCircleIcon as PhMinusCircle,
  MinusIcon as PhMinus,
  NotePencilIcon as PhNotePencil,
  PackageIcon as PhPackage,
  PaperPlaneTiltIcon as PhPaperPlaneTilt,
  PencilLineIcon as PhPencilLine,
  PencilSimpleIcon as PhPencilSimple,
  PercentIcon as PhPercent,
  PhoneCallIcon as PhPhoneCall,
  PhoneIcon as PhPhone,
  PlusCircleIcon as PhPlusCircle,
  PlusIcon as PhPlus,
  ProhibitIcon as PhProhibit,
  PulseIcon as PhPulse,
  ReceiptIcon as PhReceipt,
  RecycleIcon as PhRecycle,
  ScalesIcon as PhScales,
  SealCheckIcon as PhSealCheck,
  SignOutIcon as PhSignOut,
  SlidersHorizontalIcon as PhSlidersHorizontal,
  SparkleIcon as PhSparkle,
  SquaresFourIcon as PhSquaresFour,
  TableIcon as PhTable,
  TagIcon as PhTag,
  TrashIcon as PhTrash,
  TruckIcon as PhTruck,
  UploadSimpleIcon as PhUploadSimple,
  UserCircleIcon as PhUserCircle,
  UserGearIcon as PhUserGear,
  UserIcon as PhUser,
  UserPlusIcon as PhUserPlus,
  UsersIcon as PhUsers,
  WarningCircleIcon as PhWarningCircle,
  WarningIcon as PhWarning,
  XCircleIcon as PhXCircle,
  XIcon as PhX,
} from '@phosphor-icons/react/ssr';

export type Icone = Icon;

function decoratif(Base: Icon, nom: string): Icone {
  const Composant = forwardRef<SVGSVGElement, IconProps>(
    function IconeSavr(props, ref) {
      const nommee =
        props['aria-label'] !== undefined ||
        props['aria-labelledby'] !== undefined ||
        props['aria-hidden'] !== undefined ||
        props.role !== undefined ||
        props.alt !== undefined;
      return (
        <Base
          ref={ref}
          size={24}
          {...(nommee ? {} : { 'aria-hidden': true })}
          {...props}
        />
      );
    },
  );
  Composant.displayName = nom;
  return Composant;
}

export const ArrowClockwiseIcon = decoratif(
  PhArrowClockwise,
  'ArrowClockwiseIcon',
);
export const ArrowCounterClockwiseIcon = decoratif(
  PhArrowCounterClockwise,
  'ArrowCounterClockwiseIcon',
);
export const ArrowLeftIcon = decoratif(PhArrowLeft, 'ArrowLeftIcon');
export const ArrowRightIcon = decoratif(PhArrowRight, 'ArrowRightIcon');
export const BellIcon = decoratif(PhBell, 'BellIcon');
export const BellRingingIcon = decoratif(PhBellRinging, 'BellRingingIcon');
export const BookOpenIcon = decoratif(PhBookOpen, 'BookOpenIcon');
export const BuildingsIcon = decoratif(PhBuildings, 'BuildingsIcon');
export const CalendarDotsIcon = decoratif(PhCalendarDots, 'CalendarDotsIcon');
export const CalendarPlusIcon = decoratif(PhCalendarPlus, 'CalendarPlusIcon');
export const CalendarXIcon = decoratif(PhCalendarX, 'CalendarXIcon');
export const CaretDownIcon = decoratif(PhCaretDown, 'CaretDownIcon');
export const CaretLeftIcon = decoratif(PhCaretLeft, 'CaretLeftIcon');
export const CaretRightIcon = decoratif(PhCaretRight, 'CaretRightIcon');
export const CaretUpDownIcon = decoratif(PhCaretUpDown, 'CaretUpDownIcon');
export const CaretUpIcon = decoratif(PhCaretUp, 'CaretUpIcon');
export const ChartBarIcon = decoratif(PhChartBar, 'ChartBarIcon');
export const CheckCircleIcon = decoratif(PhCheckCircle, 'CheckCircleIcon');
export const CheckIcon = decoratif(PhCheck, 'CheckIcon');
export const ChecksIcon = decoratif(PhChecks, 'ChecksIcon');
export const ChefHatIcon = decoratif(PhChefHat, 'ChefHatIcon');
export const CircleNotchIcon = decoratif(PhCircleNotch, 'CircleNotchIcon');
export const ClipboardTextIcon = decoratif(
  PhClipboardText,
  'ClipboardTextIcon',
);
export const ClockCounterClockwiseIcon = decoratif(
  PhClockCounterClockwise,
  'ClockCounterClockwiseIcon',
);
export const ClockIcon = decoratif(PhClock, 'ClockIcon');
export const ColumnsIcon = decoratif(PhColumns, 'ColumnsIcon');
export const CopyIcon = decoratif(PhCopy, 'CopyIcon');
export const CreditCardIcon = decoratif(PhCreditCard, 'CreditCardIcon');
export const CurrencyEurIcon = decoratif(PhCurrencyEur, 'CurrencyEurIcon');
export const DoorOpenIcon = decoratif(PhDoorOpen, 'DoorOpenIcon');
export const DotsThreeIcon = decoratif(PhDotsThree, 'DotsThreeIcon');
export const DownloadSimpleIcon = decoratif(
  PhDownloadSimple,
  'DownloadSimpleIcon',
);
export const EnvelopeSimpleIcon = decoratif(
  PhEnvelopeSimple,
  'EnvelopeSimpleIcon',
);
export const EyeIcon = decoratif(PhEye, 'EyeIcon');
export const FileDashedIcon = decoratif(PhFileDashed, 'FileDashedIcon');
export const FilePlusIcon = decoratif(PhFilePlus, 'FilePlusIcon');
export const FileTextIcon = decoratif(PhFileText, 'FileTextIcon');
export const FileXIcon = decoratif(PhFileX, 'FileXIcon');
export const FlaskIcon = decoratif(PhFlask, 'FlaskIcon');
export const FloppyDiskIcon = decoratif(PhFloppyDisk, 'FloppyDiskIcon');
export const FlowArrowIcon = decoratif(PhFlowArrow, 'FlowArrowIcon');
export const ForkKnifeIcon = decoratif(PhForkKnife, 'ForkKnifeIcon');
export const GearIcon = decoratif(PhGear, 'GearIcon');
export const HandHeartIcon = decoratif(PhHandHeart, 'HandHeartIcon');
export const HandshakeIcon = decoratif(PhHandshake, 'HandshakeIcon');
export const HeartIcon = decoratif(PhHeart, 'HeartIcon');
export const IdentificationCardIcon = decoratif(
  PhIdentificationCard,
  'IdentificationCardIcon',
);
export const ImageIcon = decoratif(PhImage, 'ImageIcon');
export const InfoIcon = decoratif(PhInfo, 'InfoIcon');
export const KeyIcon = decoratif(PhKey, 'KeyIcon');
export const LeafIcon = decoratif(PhLeaf, 'LeafIcon');
export const LightningIcon = decoratif(PhLightning, 'LightningIcon');
export const ListIcon = decoratif(PhList, 'ListIcon');
export const LockSimpleIcon = decoratif(PhLockSimple, 'LockSimpleIcon');
export const MagnifyingGlassIcon = decoratif(
  PhMagnifyingGlass,
  'MagnifyingGlassIcon',
);
export const MapPinIcon = decoratif(PhMapPin, 'MapPinIcon');
export const MinusCircleIcon = decoratif(PhMinusCircle, 'MinusCircleIcon');
export const MinusIcon = decoratif(PhMinus, 'MinusIcon');
export const NotePencilIcon = decoratif(PhNotePencil, 'NotePencilIcon');
export const PackageIcon = decoratif(PhPackage, 'PackageIcon');
export const PaperPlaneTiltIcon = decoratif(
  PhPaperPlaneTilt,
  'PaperPlaneTiltIcon',
);
export const PencilLineIcon = decoratif(PhPencilLine, 'PencilLineIcon');
export const PencilSimpleIcon = decoratif(PhPencilSimple, 'PencilSimpleIcon');
export const PercentIcon = decoratif(PhPercent, 'PercentIcon');
export const PhoneCallIcon = decoratif(PhPhoneCall, 'PhoneCallIcon');
export const PhoneIcon = decoratif(PhPhone, 'PhoneIcon');
export const PlusCircleIcon = decoratif(PhPlusCircle, 'PlusCircleIcon');
export const PlusIcon = decoratif(PhPlus, 'PlusIcon');
export const ProhibitIcon = decoratif(PhProhibit, 'ProhibitIcon');
export const PulseIcon = decoratif(PhPulse, 'PulseIcon');
export const ReceiptIcon = decoratif(PhReceipt, 'ReceiptIcon');
export const RecycleIcon = decoratif(PhRecycle, 'RecycleIcon');
export const ScalesIcon = decoratif(PhScales, 'ScalesIcon');
export const SealCheckIcon = decoratif(PhSealCheck, 'SealCheckIcon');
export const SignOutIcon = decoratif(PhSignOut, 'SignOutIcon');
export const SlidersHorizontalIcon = decoratif(
  PhSlidersHorizontal,
  'SlidersHorizontalIcon',
);
export const SparkleIcon = decoratif(PhSparkle, 'SparkleIcon');
export const SquaresFourIcon = decoratif(PhSquaresFour, 'SquaresFourIcon');
export const TableIcon = decoratif(PhTable, 'TableIcon');
export const TagIcon = decoratif(PhTag, 'TagIcon');
export const TrashIcon = decoratif(PhTrash, 'TrashIcon');
export const TruckIcon = decoratif(PhTruck, 'TruckIcon');
export const UploadSimpleIcon = decoratif(PhUploadSimple, 'UploadSimpleIcon');
export const UserCircleIcon = decoratif(PhUserCircle, 'UserCircleIcon');
export const UserGearIcon = decoratif(PhUserGear, 'UserGearIcon');
export const UserIcon = decoratif(PhUser, 'UserIcon');
export const UserPlusIcon = decoratif(PhUserPlus, 'UserPlusIcon');
export const UsersIcon = decoratif(PhUsers, 'UsersIcon');
export const WarningCircleIcon = decoratif(
  PhWarningCircle,
  'WarningCircleIcon',
);
export const WarningIcon = decoratif(PhWarning, 'WarningIcon');
export const XCircleIcon = decoratif(PhXCircle, 'XCircleIcon');
export const XIcon = decoratif(PhX, 'XIcon');
