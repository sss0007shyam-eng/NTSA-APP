class OrderItem {
  OrderItem({this.id = '', this.productId, required this.name, required this.quantity, required this.unitPaise, this.refundEligible = false, this.refundExpiresAt, this.refundWindowHours = 0, this.refundStatus, this.size, this.color, this.grade});

  final String id;
  /// The product this line was bought from; lets "Buy again" re-add it. May be
  /// absent on older orders, so reorder skips lines without it.
  final String? productId;
  final String name;
  final String? size;
  final String? color;
  final String? grade;
  String get variantText => [?size, ?color, ?grade].join(' · ');
  final int quantity;
  final int unitPaise;
  final bool refundEligible;
  /// When this line's return window shuts. Set only while a return is still
  /// open, so the app can count down to it; null otherwise.
  final DateTime? refundExpiresAt;
  /// The product's own return window, in hours, shown before buying.
  final int refundWindowHours;
  /// REQUESTED / APPROVED / REJECTED once a refund has been requested.
  final String? refundStatus;

  factory OrderItem.fromJson(Map<String, dynamic> json) => OrderItem(
        id: json['id']?.toString() ?? '',
        productId: (json['productId'] as String?)?.isNotEmpty == true ? json['productId'] as String : null,
        name: json['name'] as String,
        quantity: (json['quantity'] as num).toInt(),
        unitPaise: (json['unitPaise'] as num).toInt(),
        refundEligible: json['refundEligible'] as bool? ?? false,
        refundExpiresAt: json['refundExpiresAt'] != null ? DateTime.tryParse(json['refundExpiresAt'] as String)?.toLocal() : null,
        refundWindowHours: (json['refundWindowHours'] as num?)?.toInt() ?? 0,
        refundStatus: (json['refund'] as Map?)?['status'] as String?,
        size: json['size'] as String?,
        color: json['color'] as String?,
        grade: json['grade'] as String?,
      );
}

/// One step in an order's journey, as the Backend records it (the courier's
/// webhook, or the admin/support). [status] is one of PICKED_UP, IN_TRANSIT,
/// OUT_FOR_DELIVERY, DELIVERY_FAILED, DELIVERED, RTO_INITIATED, RTO_DELIVERED,
/// ISSUE_REPORTED, UPDATE; [title] is the Backend's own wording, used when the
/// status has no translation of its own (UPDATE).
class ShipmentEvent {
  ShipmentEvent({required this.status, required this.title, this.location, required this.at});

  final String status;
  final String title;
  final String? location;
  final DateTime at;

  /// A step the customer should notice: the courier failed, or the parcel is going back.
  bool get isProblem => status == 'DELIVERY_FAILED' || status == 'RTO_INITIATED' || status == 'RTO_DELIVERED' || status == 'ISSUE_REPORTED';

  factory ShipmentEvent.fromJson(Map<String, dynamic> json) => ShipmentEvent(
        status: json['status'] as String? ?? 'UPDATE',
        title: json['title'] as String? ?? '',
        location: (json['location'] as String?)?.isNotEmpty == true ? json['location'] as String : null,
        at: DateTime.tryParse(json['occurredAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      );
}

class Order {
  Order({
    required this.id,
    required this.status,
    required this.totalPaise,
    required this.items,
    required this.createdAt,
    this.discountPaise = 0,
    this.deliveryPaise = 0,
    this.couponCode,
    this.paymentMethod,
    this.deliveredAt,
    this.deliveryPartner,
    this.expectedDeliveryAt,
    this.isVendorOrder = false,
    this.courierName,
    this.trackingNumber,
    this.trackingUrl,
    this.events = const [],
  });

  final String id;
  final String status;
  final int totalPaise;
  final List<OrderItem> items;
  final DateTime createdAt;
  final int discountPaise;
  final int deliveryPaise;
  final String? couponCode;
  final String? paymentMethod;
  final DateTime? deliveredAt;
  final String? deliveryPartner;
  final DateTime? expectedDeliveryAt;
  final bool isVendorOrder;
  /// Who is carrying it and the number to track it with, once booked.
  final String? courierName;
  final String? trackingNumber;
  final String? trackingUrl;
  /// The journey so far, oldest first.
  final List<ShipmentEvent> events;

  static const statusSteps = ['PLACED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        status: json['status'] as String,
        totalPaise: (json['totalPaise'] as num).toInt(),
        items: (json['items'] as List? ?? []).map((e) => OrderItem.fromJson(e as Map<String, dynamic>)).toList(),
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ?? DateTime.now(),
        discountPaise: (json['discountPaise'] as num?)?.toInt() ?? 0,
        deliveryPaise: (json['deliveryPaise'] as num?)?.toInt() ?? 0,
        couponCode: json['couponCode'] as String?,
        paymentMethod: json['paymentMethod'] as String?,
        deliveredAt: DateTime.tryParse(json['deliveredAt']?.toString() ?? ''),
        deliveryPartner: json['deliveryPartner'] as String?,
        expectedDeliveryAt: DateTime.tryParse(json['expectedDeliveryAt']?.toString() ?? ''),
        isVendorOrder: json['vendorId'] != null,
        courierName: json['courierName'] as String?,
        trackingNumber: json['trackingNumber'] as String?,
        trackingUrl: json['trackingUrl'] as String?,
        events: (json['events'] as List? ?? []).map((e) => ShipmentEvent.fromJson(e as Map<String, dynamic>)).toList(),
      );
}
