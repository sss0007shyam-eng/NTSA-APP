import 'product.dart';

/// What POST /products/assist sends back: the products it found, and -- just
/// as important -- how it read the sentence. The reading is shown to the
/// shopper so a wrong guess ("white · shoes · under ₹450" for "boat 450") is
/// visible and can be retyped, instead of a shelf of the wrong thing.
class AssistantReply {
  const AssistantReply({
    required this.products,
    this.color,
    this.item,
    this.category,
    this.minRupees,
    this.maxRupees,
    this.keywords = const [],
    this.relaxed,
  });

  final List<Product> products;

  /// The colour the sentence asked for, as the catalog spells it ("White").
  final String? color;

  /// The kind of thing asked for ("Shoes"), and the category it was taken to
  /// mean when the words only pointed at a whole shelf ("Fashion").
  final String? item;
  final String? category;

  /// The budget, in whole rupees. Either end may be absent.
  final int? minRupees;
  final int? maxRupees;

  /// Whatever words were left over -- a brand, a model name.
  final List<String> keywords;

  /// Which constraint had to be dropped to find anything at all:
  /// `color` (other colours shown), `budget` (nearest above it),
  /// `all` (closest products), `none` (nothing matched), or null when
  /// everything the shopper asked for was met.
  final String? relaxed;

  bool get foundNothing => relaxed == 'none' || products.isEmpty;

  /// The non-price part of what was understood, in the order it reads:
  /// "White · Shoes · nike". The price is added by the screen, which has the
  /// shopper's language for "under ₹1500".
  List<String> get labelParts => [
        if (color != null && color!.isNotEmpty) color!,
        if (item != null && item!.isNotEmpty) item! else if (category != null && category!.isNotEmpty) category!,
        ...keywords,
      ];

  static List<String> _strings(dynamic value) =>
      value is List ? value.map((e) => e.toString()).toList() : const [];

  static int? _rupees(dynamic value) => value is num ? value.toInt() : null;

  factory AssistantReply.fromJson(Map<String, dynamic> json) {
    final understood = (json['understood'] as Map?)?.cast<String, dynamic>() ?? const {};
    return AssistantReply(
      products: ((json['products'] as List?) ?? const [])
          .map((e) => Product.fromJson((e as Map).cast<String, dynamic>()))
          .toList(),
      color: understood['color'] as String?,
      item: understood['item'] as String?,
      category: understood['category'] as String?,
      minRupees: _rupees(understood['minRupees']),
      maxRupees: _rupees(understood['maxRupees']),
      keywords: _strings(understood['keywords']),
      relaxed: json['relaxed'] as String?,
    );
  }
}
