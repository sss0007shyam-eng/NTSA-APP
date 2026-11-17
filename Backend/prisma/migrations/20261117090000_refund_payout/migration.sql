-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('WALLET', 'BANK', 'UPI');

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankHolder" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "payoutAt" TIMESTAMP(3),
ADD COLUMN     "payoutRef" TEXT,
ADD COLUMN     "refundMethod" "RefundMethod" NOT NULL DEFAULT 'WALLET',
ADD COLUMN     "upiId" TEXT;

