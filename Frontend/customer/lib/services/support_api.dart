import '../core/api_client.dart';

class TicketMessage {
  TicketMessage({required this.fromCustomer, required this.name, required this.body, required this.at});

  /// True for the shopper's own messages, false for NTSA support.
  final bool fromCustomer;
  final String name;
  final String body;
  final DateTime at;

  factory TicketMessage.fromJson(Map<String, dynamic> json) => TicketMessage(
        fromCustomer: json['sender'] == 'CUSTOMER',
        name: json['name'] as String? ?? '',
        body: json['body'] as String? ?? '',
        at: DateTime.tryParse(json['at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      );
}

/// A support request about one order (not received, damaged...) and the chat
/// with NTSA support under it. The Backend leaves out staff-only notes.
class SupportTicket {
  SupportTicket({required this.id, required this.kind, required this.subject, required this.resolved, required this.orderId, required this.messages, required this.updatedAt, this.orderStatus, this.courierName, this.trackingNumber});

  final String id;
  /// NOT_RECEIVED | DAMAGED | WRONG_ITEM | OTHER | GENERAL
  final String kind;
  final String subject;
  final bool resolved;
  final String? orderId;
  final List<TicketMessage> messages;
  final DateTime updatedAt;
  final String? orderStatus;
  final String? courierName;
  final String? trackingNumber;

  factory SupportTicket.fromJson(Map<String, dynamic> json) {
    final order = json['order'] as Map<String, dynamic>?;
    return SupportTicket(
      id: json['id'] as String,
      kind: json['kind'] as String? ?? 'GENERAL',
      subject: json['subject'] as String? ?? '',
      resolved: json['status'] == 'RESOLVED',
      orderId: json['orderId'] as String?,
      messages: (json['messages'] as List? ?? []).map((m) => TicketMessage.fromJson(m as Map<String, dynamic>)).toList(),
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      orderStatus: order?['status'] as String?,
      courierName: order?['courierName'] as String?,
      trackingNumber: order?['trackingNumber'] as String?,
    );
  }
}

class SupportApi {
  /// Opens a request about an order, or adds to the one already open for it.
  static Future<SupportTicket> reportIssue(String orderId, String kind, String message) async =>
      SupportTicket.fromJson(await ApiClient.instance.post('/orders/$orderId/report-issue', data: {'kind': kind, 'message': message}) as Map<String, dynamic>);

  static Future<List<SupportTicket>> mine() async =>
      ((await ApiClient.instance.get('/tickets')) as List).map((t) => SupportTicket.fromJson(t as Map<String, dynamic>)).toList();

  static Future<SupportTicket> get(String id) async => SupportTicket.fromJson(await ApiClient.instance.get('/tickets/$id') as Map<String, dynamic>);

  static Future<SupportTicket> send(String id, String body) async =>
      SupportTicket.fromJson(await ApiClient.instance.post('/tickets/$id/message', data: {'body': body}) as Map<String, dynamic>);
}
