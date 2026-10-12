import 'package:flutter_shop/features/catalog/data/product.dart';

class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.title,
    required this.unitPrice,
    required this.quantity,
    this.thumbnail = '',
  });

  final String id;
  final String productId;
  final String title;
  final double unitPrice;
  final int quantity;
  final String thumbnail;

  double get lineTotal => unitPrice * quantity;

  CartItem copyWith({int? quantity}) => CartItem(
        id: id,
        productId: productId,
        title: title,
        unitPrice: unitPrice,
        quantity: quantity ?? this.quantity,
        thumbnail: thumbnail,
      );

  factory CartItem.fromProduct(Product product, {int quantity = 1}) => CartItem(
        id: 'local-${product.id}',
        productId: product.id,
        title: product.title,
        unitPrice: product.price,
        quantity: quantity,
        thumbnail: product.thumbnail,
      );

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
        id: json['id'] as String,
        productId: json['product_id'] as String,
        title: json['title'] as String,
        unitPrice: (json['unit_price'] as num).toDouble(),
        quantity: json['quantity'] as int,
        thumbnail: json['thumbnail'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'product_id': productId,
        'quantity': quantity,
      };
}
