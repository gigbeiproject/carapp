-- Refund requests from customers who don't want to complete KYC after booking.
-- reservationId / userId use the same collations as reservations.id / users.id.
CREATE TABLE IF NOT EXISTS refund_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  reservationId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  userId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  paymentId VARCHAR(255) NULL,
  reason VARCHAR(500) NULL,
  status ENUM('PENDING','REFUNDED','REJECTED') NOT NULL DEFAULT 'PENDING',
  adminNote VARCHAR(500) NULL,
  processedBy VARCHAR(191) NULL,
  processedAt DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refund_reservation (reservationId),
  KEY idx_refund_user (userId),
  KEY idx_refund_status (status)
);
