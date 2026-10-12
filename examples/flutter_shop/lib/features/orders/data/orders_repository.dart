import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flutter_shop/core/network/api_client.dart';

enum OrderStatus { pending, paid, shipped, delivered, cancelled }

class Order {
  const Order({
    required this.id,
    required this.total,
    required this.status,
    required this.placedAt,
    required this.itemCount,
  });

  final String id;
  final double total;
  final OrderStatus status;
  final DateTime placedAt;
  final int itemCount;

  factory Order.fromJson(Map<String, dynamic> json) => Order(
        id: json['id'] as String,
        total: (json['total'] as num).toDouble(),
        status: OrderStatus.values.byName(json['status'] as String),
        placedAt: DateTime.parse(json['placed_at'] as String),
        itemCount: json['item_count'] as int? ?? 0,
      );
}

class OrdersRepository {
  OrdersRepository(this._dio, this._firestore);

  final Dio _dio;
  final FirebaseFirestore _firestore;

  Future<List<Order>> fetchOrders() async {
    final response = await _dio.get('/orders');
    final items = response.data as List<dynamic>;
    return items.map((e) => Order.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Live status updates are pushed by the fulfilment backend into Firestore.
  Stream<OrderStatus> watchStatus(String orderId) {
    return _firestore
        .collection('orders')
        .doc(orderId)
        .snapshots()
        .map((doc) => OrderStatus.values.byName(doc.data()?['status'] as String? ?? 'pending'));
  }
}

final ordersRepositoryProvider = Provider<OrdersRepository>(
  (ref) => OrdersRepository(ref.watch(dioProvider), FirebaseFirestore.instance),
);

final ordersProvider = FutureProvider.autoDispose<List<Order>>(
  (ref) => ref.watch(ordersRepositoryProvider).fetchOrders(),
);

final recentOrderIdsProvider = StreamProvider.autoDispose<List<String>>((ref) {
  return FirebaseFirestore.instance
      .collection('orders')
      .orderBy('placed_at', descending: true)
      .limit(5)
      .snapshots()
      .map((q) => q.docs.map((d) => d.id).toList());
});
