-- phpMyAdmin SQL Dump
-- version 4.9.0.1
-- https://www.phpmyadmin.net/
--
-- Host: sql211.infinityfree.com
-- Generation Time: Apr 23, 2026 at 07:07 AM
-- Server version: 11.4.10-MariaDB
-- PHP Version: 7.2.22

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `if0_41570853_asel`
--

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

CREATE TABLE `audit_logs` (
  `id` int(11) NOT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `utilisateur_nom` varchar(100) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `cible` varchar(50) DEFAULT NULL,
  `cible_id` int(11) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `audit_logs`
--

-- --------------------------------------------------------

--
-- Table structure for table `bons_reception`
--

CREATE TABLE `bons_reception` (
  `id` int(11) NOT NULL,
  `numero` varchar(30) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `fournisseur_id` int(11) DEFAULT NULL,
  `date_reception` date DEFAULT curdate(),
  `total_ht` decimal(10,2) DEFAULT 0.00,
  `tva` decimal(10,2) DEFAULT 0.00,
  `total_ttc` decimal(10,2) DEFAULT 0.00,
  `statut` enum('brouillon','valide','annule') DEFAULT 'brouillon',
  `note` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bons_reception`
--

INSERT INTO `bons_reception` (`id`, `numero`, `franchise_id`, `fournisseur_id`, `date_reception`, `total_ht`, `tva`, `total_ttc`, `statut`, `note`, `utilisateur_id`, `date_creation`) VALUES
(1, 'BR-20260413-0001', 2, 2, '2026-04-13', '2987.21', '567.57', '3554.78', 'valide', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(2, 'BR-20260413-0002', 3, 3, '2026-04-13', '4205.60', '294.39', '4499.99', 'valide', '', 1, '2026-04-13 10:05:07'),
(3, 'BR-20260413-0003', 3, 3, '2026-04-13', '3177.58', '222.43', '3400.01', 'valide', '', 1, '2026-04-13 10:06:49'),
(5, 'BRB-20260414-0001', 2, 1, '2026-04-14', '4590.32', '872.16', '5462.48', 'valide', '', 1, '2026-04-14 13:19:13'),
(13, 'BR-20260415-0001', 3, 4, '2026-04-15', '1856.30', '352.70', '2209.00', 'valide', 'FAC-2026-00019 Date: 10/04/2026', 1, '2026-04-15 14:03:00'),
(14, 'BR-20260415-0002', 3, 4, '2026-04-15', '1687.11', '272.89', '1960.00', 'valide', 'FAC-2026-00020 Date: 03/04/2026', 1, '2026-04-15 14:06:07');

-- --------------------------------------------------------

--
-- Table structure for table `bon_reception_lignes`
--

CREATE TABLE `bon_reception_lignes` (
  `id` int(11) NOT NULL,
  `bon_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite` int(11) NOT NULL DEFAULT 0,
  `prix_unitaire_ht` decimal(10,2) DEFAULT 0.00,
  `tva_rate` decimal(5,2) DEFAULT 19.00,
  `prix_unitaire_ttc` decimal(10,2) DEFAULT 0.00,
  `total_ht` decimal(10,2) DEFAULT 0.00,
  `total_ttc` decimal(10,2) DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bon_reception_lignes`
--

INSERT INTO `bon_reception_lignes` (`id`, `bon_id`, `produit_id`, `quantite`, `prix_unitaire_ht`, `tva_rate`, `prix_unitaire_ttc`, `total_ht`, `total_ttc`) VALUES
(163, 1, 7, 10, '4.20', '19.00', '5.00', '42.01', '49.99'),
(164, 1, 8, 10, '4.37', '19.00', '5.20', '43.69', '51.99'),
(165, 1, 9, 10, '4.62', '19.00', '5.50', '46.21', '54.99'),
(166, 1, 10, 10, '4.03', '19.00', '4.80', '40.33', '47.99'),
(167, 1, 11, 10, '4.20', '19.00', '5.00', '42.01', '49.99'),
(168, 1, 12, 10, '4.62', '19.00', '5.50', '46.21', '54.99'),
(169, 1, 13, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(170, 1, 104, 5, '4.20', '19.00', '5.00', '21.01', '25.00'),
(171, 1, 105, 5, '4.37', '19.00', '5.20', '21.85', '26.00'),
(172, 1, 106, 5, '4.62', '19.00', '5.50', '23.11', '27.49'),
(173, 1, 16, 5, '5.88', '19.00', '7.00', '29.41', '35.00'),
(174, 1, 17, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(175, 1, 107, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(176, 1, 19, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(177, 1, 20, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(178, 1, 21, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(179, 1, 108, 5, '4.20', '19.00', '5.00', '21.01', '25.00'),
(180, 1, 29, 5, '21.01', '19.00', '25.00', '105.04', '125.00'),
(181, 1, 109, 5, '16.81', '19.00', '20.00', '84.03', '100.00'),
(182, 1, 33, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(183, 1, 30, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(184, 1, 31, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(185, 1, 34, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(186, 1, 110, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(187, 1, 111, 5, '15.13', '19.00', '18.00', '75.63', '90.00'),
(188, 1, 112, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(189, 1, 113, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(190, 1, 114, 5, '8.40', '19.00', '10.00', '42.02', '50.00'),
(191, 1, 53, 5, '6.72', '19.00', '8.00', '33.61', '40.00'),
(192, 1, 115, 3, '5.88', '19.00', '7.00', '17.65', '21.00'),
(193, 1, 116, 5, '5.88', '19.00', '7.00', '29.41', '35.00'),
(194, 1, 117, 2, '15.13', '19.00', '18.00', '30.25', '36.00'),
(195, 1, 41, 2, '8.40', '19.00', '10.00', '16.81', '20.00'),
(196, 1, 118, 2, '33.61', '19.00', '40.00', '67.23', '80.00'),
(197, 1, 61, 2, '12.61', '19.00', '15.00', '25.21', '30.00'),
(198, 1, 62, 2, '15.13', '19.00', '18.00', '30.25', '36.00'),
(199, 1, 119, 2, '16.81', '19.00', '20.00', '33.61', '40.00'),
(200, 1, 120, 2, '23.53', '19.00', '28.00', '47.06', '56.00'),
(201, 1, 121, 2, '23.53', '19.00', '28.00', '47.06', '56.00'),
(202, 1, 122, 2, '21.01', '19.00', '25.00', '42.02', '50.00'),
(203, 1, 73, 1, '52.10', '19.00', '62.00', '52.10', '62.00'),
(204, 1, 74, 1, '84.03', '19.00', '100.00', '84.03', '100.00'),
(205, 1, 123, 1, '67.23', '19.00', '80.00', '67.23', '80.00'),
(206, 1, 124, 1, '22.69', '19.00', '27.00', '22.69', '27.00'),
(207, 1, 125, 1, '25.21', '19.00', '30.00', '25.21', '30.00'),
(208, 1, 126, 1, '33.61', '19.00', '40.00', '33.61', '40.00'),
(209, 1, 103, 1, '29.41', '19.00', '35.00', '29.41', '35.00'),
(210, 1, 127, 1, '16.81', '19.00', '20.00', '16.81', '20.00'),
(211, 1, 128, 2, '12.61', '19.00', '15.00', '25.21', '30.00'),
(212, 1, 129, 100, '1.26', '19.00', '1.50', '126.00', '149.94'),
(213, 1, 130, 2, '33.61', '19.00', '40.00', '67.23', '80.00'),
(214, 1, 131, 1, '29.41', '19.00', '35.00', '29.41', '35.00'),
(215, 1, 102, 1, '21.01', '19.00', '25.00', '21.01', '25.00'),
(216, 1, 132, 135, '5.46', '19.00', '6.50', '737.37', '877.47'),
(217, 2, 134, 5, '841.12', '7.00', '900.00', '4205.60', '4500.00'),
(218, 3, 135, 2, '1588.79', '7.00', '1700.01', '3177.58', '3400.02'),
(220, 5, 86, 1, '52.52', '19.00', '62.50', '52.52', '62.50'),
(221, 5, 87, 2, '31.85', '19.00', '37.90', '63.70', '75.80'),
(222, 5, 88, 2, '31.51', '19.00', '37.50', '63.02', '75.00'),
(223, 5, 89, 2, '45.71', '19.00', '54.39', '91.42', '108.78'),
(224, 5, 75, 1, '273.95', '19.00', '326.00', '273.95', '326.00'),
(225, 5, 76, 1, '300.00', '19.00', '357.00', '300.00', '357.00'),
(226, 5, 77, 1, '353.78', '19.00', '421.00', '353.78', '421.00'),
(227, 5, 78, 1, '433.61', '19.00', '516.00', '433.61', '516.00'),
(228, 5, 79, 1, '236.97', '19.00', '281.99', '236.97', '281.99'),
(229, 5, 80, 1, '394.96', '19.00', '470.00', '394.96', '470.00'),
(230, 5, 81, 1, '339.50', '19.00', '404.01', '339.50', '404.01'),
(231, 5, 82, 1, '370.59', '19.00', '441.00', '370.59', '441.00'),
(232, 5, 83, 1, '228.57', '19.00', '272.00', '228.57', '272.00'),
(233, 5, 91, 1, '416.30', '19.00', '495.40', '416.30', '495.40'),
(234, 5, 84, 1, '298.32', '19.00', '355.00', '298.32', '355.00'),
(235, 5, 92, 1, '409.24', '19.00', '487.00', '409.24', '487.00'),
(236, 5, 85, 1, '263.87', '19.00', '314.01', '263.87', '314.01'),
(246, 13, 149, 1, '289.92', '19.00', '345.00', '289.92', '345.00'),
(247, 13, 148, 2, '235.29', '19.00', '280.00', '470.58', '560.00'),
(248, 13, 147, 2, '361.34', '19.00', '429.99', '722.68', '859.98'),
(249, 13, 140, 3, '27.73', '19.00', '33.00', '83.19', '99.00'),
(250, 13, 139, 3, '27.73', '19.00', '33.00', '83.19', '99.00'),
(251, 13, 138, 2, '47.90', '19.00', '57.00', '95.80', '114.00'),
(252, 13, 137, 3, '36.98', '19.00', '44.01', '110.94', '132.03'),
(253, 14, 144, 2, '222.69', '19.00', '265.00', '445.38', '530.00'),
(254, 14, 146, 1, '201.68', '19.00', '240.00', '201.68', '240.00'),
(255, 14, 145, 1, '222.68', '19.00', '264.99', '222.68', '264.99'),
(256, 14, 143, 1, '420.17', '19.00', '500.00', '420.17', '500.00'),
(257, 14, 136, 1, '397.20', '7.00', '425.00', '397.20', '425.00');

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `famille_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `categories`
--

INSERT INTO `categories` (`id`, `nom`, `description`, `famille_id`) VALUES
(1, 'Câbles', NULL, 1),
(2, 'Chargeurs', NULL, 1),
(3, 'Chargeurs auto', NULL, 1),
(4, 'Écouteurs', NULL, 2),
(5, 'Casques', NULL, 2),
(6, 'Enceintes', NULL, 2),
(7, 'Power Banks', NULL, 2),
(8, 'Supports téléphone', NULL, 1),
(9, 'Accessoires montre', NULL, 2),
(10, 'Montres connectées', NULL, 2),
(11, 'Téléphones', NULL, 3),
(12, 'Haut Parleurs', 'Baffle', NULL),
(13, '', '', NULL),
(14, 'Etui', '', NULL),
(15, 'Case Smartphone', '', NULL),
(17, 'Haut-parleurs', NULL, NULL),
(18, 'Accessoires', NULL, NULL),
(19, 'Coques', NULL, NULL),
(20, 'Scooter', '', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `clients`
--

CREATE TABLE `clients` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `prenom` varchar(100) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `telephone2` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `adresse` text DEFAULT NULL,
  `type_client` enum('passager','boutique','entreprise') DEFAULT 'passager',
  `entreprise` varchar(150) DEFAULT NULL,
  `matricule_fiscal` varchar(50) DEFAULT NULL,
  `cin` varchar(8) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `clients`
--

INSERT INTO `clients` (`id`, `nom`, `prenom`, `telephone`, `telephone2`, `email`, `adresse`, `type_client`, `entreprise`, `matricule_fiscal`, `cin`, `notes`, `franchise_id`, `actif`, `date_creation`) VALUES
(3, 'Boughabba', 'Jamel', '54647332', '', '', '', 'boutique', '', '', '', 'honor x5c', 2, 1, '2026-04-15 10:29:02'),
(4, 'Hajri', 'Hedi', '47022559', NULL, '', '', 'boutique', '', '', NULL, 'redmi 15c', 2, 1, '2026-04-15 10:29:53'),
(5, 'Bouguerra', 'Oussema', '47022550', NULL, '', '', 'boutique', '', '', NULL, '', 2, 1, '2026-04-15 10:30:50'),
(6, 'Mathlouthi', 'Karim', '47022455', NULL, '', '', 'boutique', '', '', NULL, 'Honor X5C\r\nCIN: 08303470', 2, 1, '2026-04-15 10:32:44'),
(7, 'Baccour', 'Mohamed Wajdi', '47022500', '', '', 'Dar fadhal', 'boutique', 'Coiffeur', '', '', 'Redmi 13\r\ncin: 11218455', 2, 1, '2026-04-15 10:34:10'),
(8, 'Ameri', 'Najoua', '47022870', '', '', '', 'boutique', '', '', '', 'Vivo y04', 2, 1, '2026-04-15 10:35:45'),
(9, 'Boukthir', 'Jamel', '47022755', '', '', '', 'boutique', '', '', '', 'Redmi A5', 2, 1, '2026-04-15 10:36:45'),
(10, 'Oueslati', 'Rim', '92261000', '', '', '', 'boutique', '', '', '', '', 2, 1, '2026-04-15 14:45:34'),
(11, 'Kdidi', 'Salim', '47022848', '', '', '', 'boutique', '', '', '', '', 2, 1, '2026-04-15 14:46:49'),
(12, 'Belhedef', 'Mohamed amine', '22373820', '', '', 'nahj wedhref lahneya dar fadhal', 'boutique', '', '', '14329504', '', 2, 1, '2026-04-15 16:49:32'),
(13, 'ghazali', 'walid', '47022609', '', '', '', 'boutique', '', '', '07433580', '', 2, 1, '2026-04-15 17:03:36'),
(14, 'Kochbati', 'Samir', '53355177', '', '', '', 'boutique', '', '', '', '', 2, 1, '2026-04-15 17:50:57'),
(15, 'Etbini', 'Feriel', '47022711', '', '', '', 'boutique', '', '', '', '07499184', 2, 1, '2026-04-16 11:39:41');

-- --------------------------------------------------------

--
-- Table structure for table `clotures`
--

CREATE TABLE `clotures` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `date_cloture` date NOT NULL,
  `total_ventes_declare` decimal(10,2) DEFAULT 0.00,
  `total_articles_declare` int(11) DEFAULT 0,
  `total_ventes_systeme` decimal(10,2) DEFAULT 0.00,
  `total_articles_systeme` int(11) DEFAULT 0,
  `commentaire` text DEFAULT NULL,
  `valide` tinyint(4) DEFAULT 0,
  `utilisateur_id` int(11) DEFAULT NULL,
  `validateur_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `clotures`
--

INSERT INTO `clotures` (`id`, `franchise_id`, `date_cloture`, `total_ventes_declare`, `total_articles_declare`, `total_ventes_systeme`, `total_articles_systeme`, `commentaire`, `valide`, `utilisateur_id`, `validateur_id`, `date_creation`) VALUES
(1, 2, '2026-04-15', '3187.00', 43, '6952.00', 43, 'Retard', 0, 1, NULL, '2026-04-16 11:43:10'),
(2, 2, '2026-04-16', '800.00', 2, '2820.00', 2, 'retard', 0, 1, NULL, '2026-04-16 11:44:50');

-- --------------------------------------------------------

--
-- Table structure for table `clotures_mensuelles`
--

CREATE TABLE `clotures_mensuelles` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `mois` varchar(7) NOT NULL,
  `total_ventes` decimal(10,2) DEFAULT 0.00,
  `total_encaissements` decimal(10,2) DEFAULT 0.00,
  `total_decaissements` decimal(10,2) DEFAULT 0.00,
  `solde` decimal(10,2) DEFAULT 0.00,
  `commentaire` text DEFAULT NULL,
  `valide` tinyint(4) DEFAULT 0,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `demandes_produits`
--

CREATE TABLE `demandes_produits` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `produit_id` int(11) DEFAULT NULL,
  `nom_produit` varchar(150) DEFAULT NULL,
  `quantite` int(11) NOT NULL DEFAULT 1,
  `urgence` enum('normal','urgent','critique') DEFAULT 'normal',
  `statut` enum('en_attente','en_cours','livre','rejete') DEFAULT 'en_attente',
  `note` text DEFAULT NULL,
  `demandeur_id` int(11) DEFAULT NULL,
  `gestionnaire_id` int(11) DEFAULT NULL,
  `reponse` text DEFAULT NULL,
  `date_demande` datetime DEFAULT current_timestamp(),
  `date_traitement` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `echeances`
--

CREATE TABLE `echeances` (
  `id` int(11) NOT NULL,
  `facture_id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `montant` decimal(10,2) NOT NULL,
  `date_echeance` date NOT NULL,
  `statut` enum('en_attente','payee','en_retard') DEFAULT 'en_attente',
  `date_paiement` datetime DEFAULT NULL,
  `mode_paiement` enum('especes','carte','virement','cheque') DEFAULT 'especes',
  `rappel_7j_envoye` tinyint(4) DEFAULT 0,
  `rappel_3j_envoye` tinyint(4) DEFAULT 0,
  `note` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `echeances`
--

INSERT INTO `echeances` (`id`, `facture_id`, `franchise_id`, `client_id`, `montant`, `date_echeance`, `statut`, `date_paiement`, `mode_paiement`, `rappel_7j_envoye`, `rappel_3j_envoye`, `note`, `utilisateur_id`, `date_creation`) VALUES
(10, 4, 2, 3, '100.00', '2026-05-04', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/1 — Facture TK-20260415-0004', 1, '2026-04-15 16:42:30'),
(11, 5, 2, 4, '150.00', '2026-05-05', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/1 — Facture FA-20260415-0001', 1, '2026-04-15 16:46:05'),
(12, 6, 2, 12, '316.67', '2026-05-10', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/3 — Facture TK-20260415-0005', 1, '2026-04-15 16:51:13'),
(13, 6, 2, 12, '316.67', '2026-06-09', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/3 — Facture TK-20260415-0005', 1, '2026-04-15 16:51:13'),
(14, 6, 2, 12, '316.66', '2026-07-09', 'en_attente', NULL, 'especes', 0, 0, 'Lot 3/3 — Facture TK-20260415-0005', 1, '2026-04-15 16:51:13'),
(15, 7, 2, 5, '100.00', '2026-04-20', 'payee', '2026-04-18 11:22:44', 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0006', 1, '2026-04-15 16:52:27'),
(16, 7, 2, 5, '100.00', '2026-05-20', 'en_attente', '0000-00-00 00:00:00', 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0006', 1, '2026-04-15 16:52:27'),
(17, 8, 2, 7, '215.00', '2026-05-05', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0007', 1, '2026-04-15 17:00:32'),
(18, 8, 2, 7, '215.00', '2026-06-04', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0007', 1, '2026-04-15 17:00:32'),
(19, 9, 2, 6, '80.00', '2026-05-01', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0008', 1, '2026-04-15 17:01:54'),
(20, 9, 2, 6, '80.00', '2026-05-31', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0008', 1, '2026-04-15 17:01:54'),
(21, 10, 2, 13, '140.00', '2026-04-25', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0009', 1, '2026-04-15 17:04:53'),
(22, 10, 2, 13, '140.00', '2026-05-25', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0009', 1, '2026-04-15 17:04:53'),
(23, 11, 2, 9, '100.00', '2026-04-30', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0010', 1, '2026-04-15 17:06:33'),
(24, 11, 2, 9, '100.00', '2026-05-30', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0010', 1, '2026-04-15 17:06:33'),
(25, 14, 2, 10, '100.00', '2026-05-01', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/4 — Facture TK-20260415-0013', 1, '2026-04-15 17:37:03'),
(26, 14, 2, 10, '100.00', '2026-05-31', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/4 — Facture TK-20260415-0013', 1, '2026-04-15 17:37:03'),
(27, 14, 2, 10, '100.00', '2026-06-30', 'en_attente', NULL, 'especes', 0, 0, 'Lot 3/4 — Facture TK-20260415-0013', 1, '2026-04-15 17:37:03'),
(28, 14, 2, 10, '100.00', '2026-07-30', 'en_attente', NULL, 'especes', 0, 0, 'Lot 4/4 — Facture TK-20260415-0013', 1, '2026-04-15 17:37:03'),
(29, 16, 2, 11, '100.00', '2026-04-01', 'payee', '2026-04-22 16:11:45', 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0015', 1, '2026-04-15 17:49:52'),
(30, 16, 2, 11, '207.50', '2026-05-01', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0015', 1, '2026-04-15 17:49:52'),
(31, 17, 2, 14, '270.00', '2026-04-27', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0016', 1, '2026-04-15 17:52:03'),
(32, 17, 2, 14, '270.00', '2026-05-27', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/2 — Facture TK-20260415-0016', 1, '2026-04-15 17:52:03'),
(33, 18, 2, 4, '155.00', '2026-04-20', 'payee', '2026-04-20 10:38:24', 'especes', 0, 0, 'Lot 1/4 — Facture TK-20260416-0001', 1, '2026-04-16 11:37:52'),
(34, 18, 2, 4, '155.00', '2026-05-05', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/4 — Facture TK-20260416-0001', 1, '2026-04-16 11:37:52'),
(35, 18, 2, 4, '155.00', '2026-05-20', 'en_attente', NULL, 'especes', 0, 0, 'Lot 3/4 — Facture TK-20260416-0001', 1, '2026-04-16 11:37:52'),
(36, 18, 2, 4, '155.00', '2026-06-04', 'en_attente', NULL, 'especes', 0, 0, 'Lot 4/4 — Facture TK-20260416-0001', 1, '2026-04-16 11:37:52'),
(37, 19, 2, 15, '466.67', '2026-05-05', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/3 — Facture TK-20260416-0002', 1, '2026-04-16 11:40:46'),
(38, 19, 2, 15, '466.67', '2026-06-04', 'en_attente', NULL, 'especes', 0, 0, 'Lot 2/3 — Facture TK-20260416-0002', 1, '2026-04-16 11:40:46'),
(39, 19, 2, 15, '466.66', '2026-07-04', 'en_attente', NULL, 'especes', 0, 0, 'Lot 3/3 — Facture TK-20260416-0002', 1, '2026-04-16 11:40:46'),
(40, 16, 2, 11, '107.50', '2026-05-01', 'en_attente', NULL, 'especes', 0, 0, 'Lot 1/2 — Facture TK-20260415-0015 [Reste après paiement partiel]', 1, '2026-04-22 16:11:45');

-- --------------------------------------------------------

--
-- Table structure for table `factures`
--

CREATE TABLE `factures` (
  `id` int(11) NOT NULL,
  `numero` varchar(30) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `client_id` int(11) DEFAULT NULL,
  `type_facture` enum('ticket','facture','devis') DEFAULT 'ticket',
  `sous_total` decimal(10,2) DEFAULT 0.00,
  `remise_totale` decimal(10,2) DEFAULT 0.00,
  `total_ht` decimal(10,2) DEFAULT 0.00,
  `tva` decimal(10,2) DEFAULT 0.00,
  `total_ttc` decimal(10,2) DEFAULT 0.00,
  `mode_paiement` enum('especes','carte','virement','cheque','mixte') DEFAULT 'especes',
  `montant_recu` decimal(10,2) DEFAULT 0.00,
  `monnaie` decimal(10,2) DEFAULT 0.00,
  `statut` enum('payee','en_attente','annulee') DEFAULT 'payee',
  `utilisateur_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `date_facture` datetime DEFAULT current_timestamp(),
  `tva_montant` decimal(10,2) DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `factures`
--

INSERT INTO `factures` (`id`, `numero`, `franchise_id`, `client_id`, `type_facture`, `sous_total`, `remise_totale`, `total_ht`, `tva`, `total_ttc`, `mode_paiement`, `montant_recu`, `monnaie`, `statut`, `utilisateur_id`, `note`, `date_facture`, `tva_montant`) VALUES
(1, 'TK-20260415-0001', 2, NULL, 'ticket', '399.04', '35.04', '305.88', '58.12', '364.00', 'especes', '364.00', '0.00', 'payee', 1, NULL, '2026-04-15 15:42:51', '0.00'),
(2, 'TK-20260415-0002', 2, NULL, 'ticket', '65.00', '0.00', '54.62', '10.38', '65.00', 'especes', '65.00', '0.00', 'payee', 1, NULL, '2026-04-15 15:53:27', '0.00'),
(3, 'TK-20260415-0003', 2, NULL, 'ticket', '155.02', '0.02', '130.25', '24.75', '155.00', 'especes', '0.00', '0.00', 'payee', 1, NULL, '2026-04-15 16:26:33', '0.00'),
(4, 'TK-20260415-0004', 2, 3, 'ticket', '420.00', '0.00', '352.94', '67.06', '420.00', '', '320.00', '0.00', 'payee', 1, NULL, '2026-04-15 16:42:30', '0.00'),
(5, 'FA-20260415-0001', 2, 4, 'facture', '450.00', '0.00', '378.15', '71.85', '450.00', '', '300.00', '0.00', 'payee', 1, NULL, '2026-04-15 16:46:05', '0.00'),
(6, 'TK-20260415-0005', 2, 12, 'ticket', '1250.00', '0.00', '1300.00', '199.58', '1300.00', '', '350.00', '0.00', 'payee', 1, NULL, '2026-04-15 16:51:13', '0.00'),
(7, 'TK-20260415-0006', 2, 5, 'ticket', '320.00', '0.00', '330.00', '51.09', '330.00', '', '130.00', '0.00', 'payee', 1, NULL, '2026-04-15 16:52:27', '0.00'),
(8, 'TK-20260415-0007', 2, 7, 'ticket', '880.02', '0.02', '739.50', '140.50', '880.00', '', '450.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:00:32', '0.00'),
(9, 'TK-20260415-0008', 2, 6, 'ticket', '360.00', '0.00', '302.52', '57.48', '360.00', '', '200.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:01:54', '0.00'),
(10, 'TK-20260415-0009', 2, 13, 'ticket', '495.00', '15.00', '403.36', '76.64', '480.00', '', '200.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:04:53', '0.00'),
(11, 'TK-20260415-0010', 2, 9, 'ticket', '350.00', '0.00', '294.12', '55.88', '350.00', '', '150.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:06:33', '0.00'),
(12, 'TK-20260415-0011', 2, NULL, 'ticket', '90.00', '7.00', '69.75', '13.25', '83.00', 'especes', '83.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:13:18', '0.00'),
(13, 'TK-20260415-0012', 2, NULL, 'ticket', '45.00', '5.00', '33.61', '6.39', '40.00', 'especes', '45.00', '5.00', 'payee', 1, NULL, '2026-04-15 17:15:38', '0.00'),
(14, 'TK-20260415-0013', 2, 10, 'ticket', '570.00', '0.00', '478.99', '91.01', '570.00', '', '170.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:37:03', '0.00'),
(15, 'TK-20260415-0014', 2, NULL, 'ticket', '130.00', '0.00', '109.24', '20.76', '130.00', 'especes', '130.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:38:04', '0.00'),
(16, 'TK-20260415-0015', 2, 11, 'ticket', '495.00', '0.00', '415.97', '79.03', '495.00', '', '80.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:49:52', '0.00'),
(17, 'TK-20260415-0016', 2, 14, 'ticket', '575.00', '35.00', '453.78', '86.22', '540.00', '', '0.00', '0.00', 'payee', 1, NULL, '2026-04-15 17:52:03', '0.00'),
(18, 'TK-20260416-0001', 2, 4, 'ticket', '620.00', '0.00', '620.00', '98.99', '620.00', '', '0.00', '0.00', 'payee', 1, NULL, '2026-04-16 11:37:52', '0.00'),
(19, 'TK-20260416-0002', 2, 15, 'ticket', '2250.00', '50.00', '2200.00', '351.26', '2200.00', '', '800.00', '0.00', 'payee', 1, NULL, '2026-04-16 11:40:46', '0.00'),
(20, 'FA-20260416-0001', 2, NULL, 'facture', '50.00', '50.00', '0.00', '0.00', '0.00', 'especes', '0.00', '0.00', 'payee', 1, NULL, '2026-04-16 12:46:29', '0.00'),
(21, 'TK-20260417-0001', 2, NULL, 'ticket', '69.00', '0.00', '57.98', '11.02', '69.00', 'especes', '69.00', '0.00', 'annulee', 1, NULL, '2026-04-17 11:14:23', '0.00'),
(22, 'FA-20260417-0001', 2, NULL, 'facture', '65.00', '0.00', '54.62', '10.38', '65.00', 'especes', '65.00', '0.00', 'payee', 1, NULL, '2026-04-17 15:00:11', '0.00'),
(23, 'TK-20260417-0002', 2, NULL, 'ticket', '30.00', '0.00', '25.21', '4.79', '30.00', 'especes', '25.00', '0.00', 'payee', 1, NULL, '2026-04-17 15:27:45', '0.00'),
(24, 'TK-20260420-0001', 2, NULL, 'ticket', '22.00', '0.00', '18.49', '3.51', '22.00', 'especes', '0.00', '0.00', 'payee', 1, NULL, '2026-04-20 17:02:49', '0.00');

-- --------------------------------------------------------

--
-- Table structure for table `facture_lignes`
--

CREATE TABLE `facture_lignes` (
  `id` int(11) NOT NULL,
  `facture_id` int(11) NOT NULL,
  `type_ligne` enum('produit','service','recharge') DEFAULT 'produit',
  `produit_id` int(11) DEFAULT NULL,
  `service_id` int(11) DEFAULT NULL,
  `designation` varchar(200) NOT NULL,
  `quantite` int(11) DEFAULT 1,
  `prix_unitaire` decimal(10,2) NOT NULL,
  `remise` decimal(10,2) DEFAULT 0.00,
  `total` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `facture_lignes`
--

INSERT INTO `facture_lignes` (`id`, `facture_id`, `type_ligne`, `produit_id`, `service_id`, `designation`, `quantite`, `prix_unitaire`, `remise`, `total`) VALUES
(1, 1, 'produit', 11, NULL, 'Cable iPhone USB to Iphone 2.4A', 3, '15.01', '0.03', '45.00'),
(2, 1, 'produit', 10, NULL, 'Cable Iphone USB to Iphone 2.1A 1m', 1, '15.01', '0.01', '15.00'),
(3, 1, 'produit', 13, NULL, 'Cable Iphone USB to Iphone 3 Metres', 1, '30.00', '20.00', '10.00'),
(4, 1, 'produit', 20, NULL, 'Type C, 3,1A 1metre', 2, '22.00', '0.00', '44.00'),
(5, 1, 'produit', 9, NULL, 'type C 2,4, 1 metre', 3, '15.00', '15.00', '30.00'),
(6, 1, 'produit', 106, NULL, 'Cable micro 3.1 1m', 1, '20.00', '0.00', '20.00'),
(7, 1, 'produit', 8, NULL, 'type C 3.0, 1 metre', 5, '18.00', '0.00', '90.00'),
(8, 1, 'produit', 34, NULL, '2.4 LIGHTING', 1, '30.00', '0.00', '30.00'),
(9, 1, 'produit', 29, NULL, 'Sortie type C / USB 35W', 1, '50.00', '0.00', '50.00'),
(10, 1, 'produit', 33, NULL, 'Smart charger 2,4A', 1, '30.00', '0.00', '30.00'),
(11, 2, 'produit', 107, NULL, 'Cable type-c type-c inkax', 2, '25.00', '0.00', '50.00'),
(12, 2, 'produit', 15, NULL, 'cable usb-lightning 1m', 1, '15.00', '0.00', '15.00'),
(13, 3, 'produit', 115, NULL, 'Kit ecouteur R12', 2, '15.01', '0.02', '30.00'),
(14, 3, 'produit', 126, NULL, 'Haut parleur 905 Boom Box', 1, '65.00', '0.00', '65.00'),
(15, 3, 'produit', 103, NULL, 'Portable loudspeaker ', 1, '60.00', '0.00', '60.00'),
(16, 4, 'produit', 76, NULL, 'Honor X5C plus 4/128', 1, '420.00', '0.00', '420.00'),
(17, 5, 'produit', 81, NULL, 'Xiaomi Redmi 15C 4/128', 1, '450.00', '0.00', '450.00'),
(18, 6, 'produit', 134, NULL, 'TROTINETTE SPIDER MAX 500W', 1, '1250.00', '0.00', '1250.00'),
(19, 7, 'produit', 79, NULL, 'Realme Note 60X 3/64', 1, '320.00', '0.00', '320.00'),
(20, 8, 'produit', 145, NULL, 'Itel A90', 1, '330.00', '0.00', '330.00'),
(21, 8, 'produit', 80, NULL, 'Xiaomi Redmi 13 6/128', 1, '550.02', '0.02', '550.00'),
(22, 9, 'produit', 75, NULL, 'Honor X5C 4/64', 1, '360.00', '0.00', '360.00'),
(23, 10, 'produit', 77, NULL, 'Honor X6C 6/128', 1, '495.00', '15.00', '480.00'),
(24, 11, 'produit', 83, NULL, 'Xiaomi Redmi A5 3/64', 1, '350.00', '0.00', '350.00'),
(25, 12, 'produit', 87, NULL, 'Geniphone A2mini', 2, '45.00', '7.00', '83.00'),
(26, 13, 'produit', 88, NULL, 'Logicom P197E', 1, '45.00', '5.00', '40.00'),
(27, 14, 'produit', 78, NULL, 'Realme C61 8/256', 1, '570.00', '0.00', '570.00'),
(28, 15, 'produit', 89, NULL, 'Nokia 105 2024', 2, '65.00', '0.00', '130.00'),
(29, 16, 'produit', 82, NULL, 'Xiaomi Redmi 15C 6/128', 1, '495.00', '0.00', '495.00'),
(30, 17, 'produit', 143, NULL, 'Vivo Y21D 8/256', 1, '575.00', '35.00', '540.00'),
(31, 18, 'produit', 147, NULL, 'Redmi 15C 6/128', 1, '620.00', '0.00', '620.00'),
(32, 19, 'produit', 135, NULL, 'SCOOTER WOLF X2 500W 22 / 23', 1, '2250.00', '50.00', '2200.00'),
(33, 20, 'produit', 124, NULL, 'LIKENUO Haut parleur LX01', 1, '50.00', '50.00', '0.00'),
(34, 21, 'produit', 86, NULL, 'Evertek E28', 1, '69.00', '0.00', '69.00'),
(35, 22, 'produit', 137, NULL, 'Tecno T101', 1, '65.00', '0.00', '65.00'),
(36, 23, 'produit', 61, NULL, 'P9 Normal', 1, '30.00', '0.00', '30.00'),
(37, 24, 'produit', 20, NULL, 'Type C, 3,1A 1metre', 1, '22.00', '0.00', '22.00');

-- --------------------------------------------------------

--
-- Table structure for table `familles`
--

CREATE TABLE `familles` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `familles`
--

INSERT INTO `familles` (`id`, `nom`, `description`, `actif`) VALUES
(1, 'Accessoires Téléphone', NULL, 1),
(2, 'Appareils Électroniques', NULL, 1),
(3, 'Téléphonie', NULL, 1),
(4, 'Scooter', '', 1);

-- --------------------------------------------------------

--
-- Table structure for table `fournisseurs`
--

CREATE TABLE `fournisseurs` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `telephone2` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `adresse` varchar(255) DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1,
  `ice` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `fournisseurs`
--

INSERT INTO `fournisseurs` (`id`, `nom`, `telephone`, `telephone2`, `email`, `adresse`, `actif`, `ice`) VALUES
(1, 'Actelo', '', NULL, '', 'Tunisie', 1, '1847204/Y'),
(2, 'STIC (Ste Tunisienne d’investissement commercial)', '90487380', NULL, '', '01 Rue Ghar El-Melh-2089 Kram-Tunis', 1, '1124287Z /'),
(3, 'Société VLT MOTORS', '70654300', NULL, '', 'Route de Tunis km 127 Akouda Sousse 4000 4022 Tu', 1, '1912697C'),
(4, 'INFOGENIE', '53193192', '', '', 'Galerie Soula Parc Lafayette & cité el intilaka', 1, '1072915/R');

-- --------------------------------------------------------

--
-- Table structure for table `franchises`
--

CREATE TABLE `franchises` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `type_franchise` enum('central','point_de_vente') DEFAULT 'point_de_vente',
  `adresse` varchar(255) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `responsable` varchar(100) DEFAULT NULL,
  `horaires` varchar(255) DEFAULT 'Lun-Sam: 09:00-19:00',
  `notes_internes` text DEFAULT NULL,
  `statut_commercial` enum('prospect','contact','contrat_non_signe','contrat_signe','actif','suspendu','resilie') DEFAULT 'actif',
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `franchises`
--

INSERT INTO `franchises` (`id`, `nom`, `type_franchise`, `adresse`, `telephone`, `responsable`, `horaires`, `notes_internes`, `statut_commercial`, `latitude`, `longitude`, `actif`, `date_creation`) VALUES
(1, 'ASEL Mobile — Mourouj', 'point_de_vente', 'Mourouj, Ben Arous', '52 123 456', 'Gérant Mourouj', 'Lun-Sam: 09:00-19:00', NULL, 'actif', '36.73400000', '10.15470000', 1, '2026-04-03 07:16:57'),
(2, 'ASEL Mobile — Soukra', 'point_de_vente', 'Soukra, Ariana', '47001500', 'Gérant Soukra', 'Lun-Sam: 09:00-19:00', NULL, 'actif', '36.86717900', '10.25078900', 1, '2026-04-03 07:16:57'),
(3, 'Stock Central', 'central', 'Entrepôt principal', '', 'Administrateur', 'Lun-Sam: 09:00-19:00', NULL, 'actif', NULL, NULL, 1, '2026-04-07 04:52:56'),
(4, 'Cite Intileka', 'point_de_vente', '', '', 'intileka', 'Lun-Sam: 09:00-19:00', NULL, 'actif', NULL, NULL, 1, '2026-04-15 13:04:29'),
(5, 'Marsa', 'point_de_vente', '', '47001566', 'Sirine Hadiji', 'Lun-Sam: 09:00-19:00', '', 'actif', NULL, NULL, 0, '2026-04-15 17:11:06');

-- --------------------------------------------------------

--
-- Table structure for table `horaires`
--

CREATE TABLE `horaires` (
  `id` int(11) NOT NULL,
  `utilisateur_id` int(11) NOT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `heure_debut` time DEFAULT '08:00:00',
  `heure_fin` time DEFAULT '17:00:00',
  `jours_travail` varchar(20) DEFAULT '1,2,3,4,5',
  `actif` tinyint(4) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventaires`
--

CREATE TABLE `inventaires` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `mois` varchar(7) NOT NULL,
  `statut` enum('en_cours','soumis','valide','rejete') DEFAULT 'en_cours',
  `date_debut` datetime DEFAULT current_timestamp(),
  `date_soumission` datetime DEFAULT NULL,
  `date_validation` datetime DEFAULT NULL,
  `commentaire` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `validateur_id` int(11) DEFAULT NULL,
  `ecarts_count` int(11) DEFAULT 0,
  `ecarts_valeur` decimal(10,2) DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventaire_lignes`
--

CREATE TABLE `inventaire_lignes` (
  `id` int(11) NOT NULL,
  `inventaire_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite_systeme` int(11) DEFAULT 0,
  `quantite_physique` int(11) DEFAULT NULL,
  `ecart` int(11) DEFAULT 0,
  `note` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `mouvements`
--

CREATE TABLE `mouvements` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `type_mouvement` varchar(20) NOT NULL,
  `quantite` int(11) NOT NULL,
  `prix_unitaire` decimal(10,2) DEFAULT 0.00,
  `note` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_mouvement` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `mouvements`
--

INSERT INTO `mouvements` (`id`, `franchise_id`, `produit_id`, `type_mouvement`, `quantite`, `prix_unitaire`, `note`, `utilisateur_id`, `date_mouvement`) VALUES
(1, 2, 7, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(2, 2, 8, 'entree', 10, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(3, 2, 9, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(4, 2, 10, 'entree', 10, '4.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(5, 2, 11, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(6, 2, 12, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(7, 2, 13, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(8, 2, 104, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(9, 2, 105, 'entree', 5, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(10, 2, 106, 'entree', 5, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(11, 2, 16, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(12, 2, 17, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(13, 2, 107, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(14, 2, 19, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(15, 2, 20, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(16, 2, 21, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(17, 2, 108, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(18, 2, 29, 'entree', 5, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(19, 2, 109, 'entree', 5, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(20, 2, 33, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(21, 2, 30, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(22, 2, 31, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(23, 2, 34, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(24, 2, 110, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(25, 2, 111, 'entree', 5, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(26, 2, 112, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(27, 2, 113, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(28, 2, 114, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(29, 2, 53, 'entree', 5, '6.72', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(30, 2, 115, 'entree', 3, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(31, 2, 116, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(32, 2, 117, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(33, 2, 41, 'entree', 2, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(34, 2, 118, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(35, 2, 61, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(36, 2, 62, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(37, 2, 119, 'entree', 2, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(38, 2, 120, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(39, 2, 121, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(40, 2, 122, 'entree', 2, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(41, 2, 73, 'entree', 1, '52.10', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(42, 2, 74, 'entree', 1, '84.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(43, 2, 123, 'entree', 1, '67.23', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(44, 2, 124, 'entree', 1, '22.69', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(45, 2, 125, 'entree', 1, '25.21', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(46, 2, 126, 'entree', 1, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(47, 2, 103, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(48, 2, 127, 'entree', 1, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(49, 2, 128, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(50, 2, 129, 'entree', 100, '1.26', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(51, 2, 130, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(52, 2, 131, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(53, 2, 102, 'entree', 1, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(54, 2, 132, 'entree', 135, '5.46', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:05:36'),
(55, 2, 7, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(56, 2, 8, 'entree', 10, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(57, 2, 9, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(58, 2, 10, 'entree', 10, '4.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(59, 2, 11, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(60, 2, 12, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(61, 2, 13, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(62, 2, 104, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(63, 2, 105, 'entree', 5, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(64, 2, 106, 'entree', 5, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(65, 2, 16, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(66, 2, 17, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(67, 2, 107, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(68, 2, 19, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(69, 2, 20, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(70, 2, 21, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(71, 2, 108, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(72, 2, 29, 'entree', 5, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(73, 2, 109, 'entree', 5, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(74, 2, 33, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(75, 2, 30, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(76, 2, 31, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(77, 2, 34, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(78, 2, 110, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(79, 2, 111, 'entree', 5, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(80, 2, 112, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(81, 2, 113, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(82, 2, 114, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(83, 2, 53, 'entree', 5, '6.72', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(84, 2, 115, 'entree', 3, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(85, 2, 116, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(86, 2, 117, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(87, 2, 41, 'entree', 2, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(88, 2, 118, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(89, 2, 61, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(90, 2, 62, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(91, 2, 119, 'entree', 2, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(92, 2, 120, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(93, 2, 121, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(94, 2, 122, 'entree', 2, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(95, 2, 73, 'entree', 1, '52.10', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(96, 2, 74, 'entree', 1, '84.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(97, 2, 123, 'entree', 1, '67.23', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(98, 2, 124, 'entree', 1, '22.69', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(99, 2, 125, 'entree', 1, '25.21', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(100, 2, 126, 'entree', 1, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(101, 2, 103, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(102, 2, 127, 'entree', 1, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(103, 2, 128, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(104, 2, 129, 'entree', 100, '1.26', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(105, 2, 130, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(106, 2, 131, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(107, 2, 102, 'entree', 1, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(108, 2, 132, 'entree', 135, '5.46', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:53:50'),
(109, 2, 7, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(110, 2, 8, 'entree', 10, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(111, 2, 9, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(112, 2, 10, 'entree', 10, '4.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(113, 2, 11, 'entree', 10, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(114, 2, 12, 'entree', 10, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(115, 2, 13, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(116, 2, 104, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(117, 2, 105, 'entree', 5, '4.37', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(118, 2, 106, 'entree', 5, '4.62', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(119, 2, 16, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(120, 2, 17, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(121, 2, 107, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(122, 2, 19, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(123, 2, 20, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(124, 2, 21, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(125, 2, 108, 'entree', 5, '4.20', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(126, 2, 29, 'entree', 5, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(127, 2, 109, 'entree', 5, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(128, 2, 33, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(129, 2, 30, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(130, 2, 31, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(131, 2, 34, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(132, 2, 110, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(133, 2, 111, 'entree', 5, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(134, 2, 112, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(135, 2, 113, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(136, 2, 114, 'entree', 5, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(137, 2, 53, 'entree', 5, '6.72', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(138, 2, 115, 'entree', 3, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(139, 2, 116, 'entree', 5, '5.88', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(140, 2, 117, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(141, 2, 41, 'entree', 2, '8.40', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(142, 2, 118, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:26'),
(143, 2, 61, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(144, 2, 62, 'entree', 2, '15.13', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(145, 2, 119, 'entree', 2, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(146, 2, 120, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(147, 2, 121, 'entree', 2, '23.53', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(148, 2, 122, 'entree', 2, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(149, 2, 73, 'entree', 1, '52.10', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(150, 2, 74, 'entree', 1, '84.03', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(151, 2, 123, 'entree', 1, '67.23', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(152, 2, 124, 'entree', 1, '22.69', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(153, 2, 125, 'entree', 1, '25.21', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(154, 2, 126, 'entree', 1, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(155, 2, 103, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(156, 2, 127, 'entree', 1, '16.81', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(157, 2, 128, 'entree', 2, '12.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(158, 2, 129, 'entree', 100, '1.26', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(159, 2, 130, 'entree', 2, '33.61', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(160, 2, 131, 'entree', 1, '29.41', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(161, 2, 102, 'entree', 1, '21.01', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(162, 2, 132, 'entree', 135, '5.46', 'Facture 34-2026 Mokhtar', 1, '2026-04-13 09:58:27'),
(163, 3, 134, 'entree', 5, '841.12', 'BR BR-20260413-0002', 1, '2026-04-13 10:05:07'),
(164, 3, 135, 'entree', 2, '1588.79', 'BR BR-20260413-0003', 1, '2026-04-13 10:06:49'),
(165, 3, 135, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-13 10:07:19'),
(166, 2, 135, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-13 10:07:19'),
(167, 3, 134, 'dispatch_out', 2, '0.00', 'Dispatch → franchise #2', 1, '2026-04-13 10:07:36'),
(168, 2, 134, 'dispatch_in', 2, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-13 10:07:36'),
(169, 2, 86, 'entree', 1, '52.52', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(170, 2, 87, 'entree', 2, '31.85', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(171, 2, 88, 'entree', 2, '31.51', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(172, 2, 89, 'entree', 2, '45.71', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(173, 2, 75, 'entree', 1, '273.95', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(174, 2, 76, 'entree', 1, '300.00', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(175, 2, 77, 'entree', 1, '353.78', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(176, 2, 78, 'entree', 1, '433.61', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(177, 2, 79, 'entree', 1, '236.97', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(178, 2, 80, 'entree', 1, '394.96', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(179, 2, 81, 'entree', 1, '339.50', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(180, 2, 82, 'entree', 1, '370.59', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(181, 2, 83, 'entree', 1, '228.57', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(182, 2, 91, 'entree', 1, '416.30', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(183, 2, 84, 'entree', 1, '298.32', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(184, 2, 92, 'entree', 1, '409.24', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(185, 2, 85, 'entree', 1, '263.87', 'BR BRB-20260414-0001 (validé)', 1, '2026-04-14 14:04:45'),
(186, 3, 149, 'entree', 1, '289.92', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(187, 3, 148, 'entree', 2, '235.29', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(188, 3, 147, 'entree', 2, '361.34', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(189, 3, 140, 'entree', 3, '27.73', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(190, 3, 139, 'entree', 3, '27.73', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(191, 3, 138, 'entree', 2, '47.90', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(192, 3, 137, 'entree', 3, '36.98', 'BR BR-20260415-0001', 1, '2026-04-15 14:03:00'),
(193, 3, 144, 'entree', 2, '222.69', 'BR BR-20260415-0002', 1, '2026-04-15 14:06:07'),
(194, 3, 146, 'entree', 1, '201.68', 'BR BR-20260415-0002', 1, '2026-04-15 14:06:07'),
(195, 3, 145, 'entree', 1, '222.68', 'BR BR-20260415-0002', 1, '2026-04-15 14:06:07'),
(196, 3, 143, 'entree', 1, '420.17', 'BR BR-20260415-0002', 1, '2026-04-15 14:06:07'),
(197, 3, 136, 'entree', 1, '397.20', 'BR BR-20260415-0002', 1, '2026-04-15 14:06:07'),
(198, 3, 143, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:40:24'),
(199, 2, 143, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:40:24'),
(200, 3, 148, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:40:45'),
(201, 2, 148, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:40:45'),
(202, 3, 139, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:41:06'),
(203, 2, 139, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:41:06'),
(204, 3, 138, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:41:14'),
(205, 2, 138, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:41:14'),
(206, 3, 137, 'dispatch_out', 2, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:41:26'),
(207, 2, 137, 'dispatch_in', 2, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:41:26'),
(208, 3, 140, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #1', 1, '2026-04-15 14:41:31'),
(209, 1, 140, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:41:31'),
(210, 3, 140, 'dispatch_out', 2, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:41:53'),
(211, 2, 140, 'dispatch_in', 2, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:41:53'),
(212, 3, 144, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:42:20'),
(213, 2, 144, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:42:20'),
(214, 3, 147, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 14:42:45'),
(215, 2, 147, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 14:42:45'),
(216, 2, 11, 'vente', 3, '15.01', NULL, 1, '2026-04-15 15:42:51'),
(217, 2, 10, 'vente', 1, '15.01', NULL, 1, '2026-04-15 15:42:51'),
(218, 2, 13, 'vente', 1, '30.00', NULL, 1, '2026-04-15 15:42:51'),
(219, 2, 20, 'vente', 2, '22.00', NULL, 1, '2026-04-15 15:42:51'),
(220, 2, 9, 'vente', 3, '15.00', NULL, 1, '2026-04-15 15:42:51'),
(221, 2, 106, 'vente', 1, '20.00', NULL, 1, '2026-04-15 15:42:51'),
(222, 2, 8, 'vente', 5, '18.00', NULL, 1, '2026-04-15 15:42:51'),
(223, 2, 34, 'vente', 1, '30.00', NULL, 1, '2026-04-15 15:42:51'),
(224, 2, 29, 'vente', 1, '50.00', NULL, 1, '2026-04-15 15:42:51'),
(225, 2, 33, 'vente', 1, '30.00', NULL, 1, '2026-04-15 15:42:51'),
(226, 2, 107, 'vente', 2, '25.00', NULL, 1, '2026-04-15 15:53:27'),
(227, 2, 15, 'vente', 1, '15.00', NULL, 1, '2026-04-15 15:53:27'),
(228, 2, 115, 'vente', 2, '15.01', NULL, 1, '2026-04-15 16:26:33'),
(229, 2, 126, 'vente', 1, '65.00', NULL, 1, '2026-04-15 16:26:33'),
(230, 2, 103, 'vente', 1, '60.00', NULL, 1, '2026-04-15 16:26:33'),
(231, 2, 76, 'vente', 1, '420.00', NULL, 1, '2026-04-15 16:42:30'),
(232, 2, 81, 'vente', 1, '450.00', NULL, 1, '2026-04-15 16:46:05'),
(233, 2, 134, 'vente', 1, '1250.00', NULL, 1, '2026-04-15 16:51:13'),
(234, 2, 79, 'vente', 1, '320.00', NULL, 1, '2026-04-15 16:52:27'),
(235, 3, 145, 'dispatch_out', 1, '0.00', 'Dispatch → franchise #2', 1, '2026-04-15 16:57:46'),
(236, 2, 145, 'dispatch_in', 1, '0.00', 'Dispatch depuis Stock Central', 1, '2026-04-15 16:57:46'),
(237, 2, 145, 'vente', 1, '330.00', NULL, 1, '2026-04-15 17:00:32'),
(238, 2, 80, 'vente', 1, '550.02', NULL, 1, '2026-04-15 17:00:32'),
(239, 2, 75, 'vente', 1, '360.00', NULL, 1, '2026-04-15 17:01:54'),
(240, 2, 77, 'vente', 1, '495.00', NULL, 1, '2026-04-15 17:04:53'),
(241, 2, 83, 'vente', 1, '350.00', NULL, 1, '2026-04-15 17:06:33'),
(242, 2, 87, 'vente', 2, '45.00', NULL, 1, '2026-04-15 17:13:18'),
(243, 2, 88, 'vente', 1, '45.00', NULL, 1, '2026-04-15 17:15:38'),
(244, 2, 78, 'vente', 1, '570.00', NULL, 1, '2026-04-15 17:37:03'),
(245, 2, 89, 'vente', 2, '65.00', NULL, 1, '2026-04-15 17:38:04'),
(246, 2, 82, 'vente', 1, '495.00', NULL, 1, '2026-04-15 17:49:52'),
(247, 2, 143, 'vente', 1, '575.00', NULL, 1, '2026-04-15 17:52:03'),
(248, 2, 147, 'vente', 1, '620.00', NULL, 1, '2026-04-16 11:37:52'),
(249, 2, 135, 'vente', 1, '2250.00', NULL, 1, '2026-04-16 11:40:46'),
(250, 2, 124, 'vente', 1, '50.00', NULL, 1, '2026-04-16 12:46:29'),
(251, 2, 86, 'vente', 1, '69.00', NULL, 1, '2026-04-17 11:14:23'),
(252, 2, 86, 'ajustement', 1, '0.00', 'Annulation facture TK-20260417-0001', 1, '2026-04-17 14:57:15'),
(253, 2, 137, 'vente', 1, '65.00', NULL, 1, '2026-04-17 15:00:11'),
(254, 2, 61, 'vente', 1, '30.00', NULL, 1, '2026-04-17 15:27:45'),
(255, 2, 20, 'vente', 1, '22.00', NULL, 1, '2026-04-20 17:02:49');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `role_cible` varchar(20) DEFAULT NULL,
  `titre` varchar(200) NOT NULL,
  `message` text DEFAULT NULL,
  `type_notif` enum('info','warning','danger','success') DEFAULT 'info',
  `lien` varchar(200) DEFAULT NULL,
  `lu` tinyint(4) DEFAULT 0,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `utilisateur_id`, `franchise_id`, `role_cible`, `titre`, `message`, `type_notif`, `lien`, `lu`, `date_creation`) VALUES
(3, NULL, 2, NULL, '⚠️ Cable type-c type-c inkax', 'Soukra — Stock bas: 3 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-15 15:53:27'),
(4, NULL, 2, NULL, '⚠️ Kit ecouteur R12', 'Soukra — Stock bas: 1 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:26:33'),
(5, NULL, 2, NULL, '⚠️ Haut parleur 905 Boom Box', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:26:33'),
(6, NULL, 2, NULL, '⚠️ Portable loudspeaker ', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:26:33'),
(7, NULL, 2, NULL, '⚠️ Honor X5C plus 4/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:42:30'),
(8, NULL, 2, NULL, '⚠️ Xiaomi Redmi 15C 4/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:46:05'),
(9, NULL, 2, NULL, '⚠️ TROTINETTE SPIDER MAX 500W', 'Soukra — Stock bas: 1 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:51:13'),
(10, NULL, 2, NULL, '⚠️ Realme Note 60X 3/64', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 16:52:27'),
(11, NULL, 2, NULL, '⚠️ Itel A90', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:00:32'),
(12, NULL, 2, NULL, '⚠️ Xiaomi Redmi 13 6/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:00:32'),
(13, NULL, 2, NULL, '⚠️ Honor X5C 4/64', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:01:54'),
(14, NULL, 2, NULL, '⚠️ Honor X6C 6/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:04:53'),
(15, NULL, 2, NULL, '⚠️ Xiaomi Redmi A5 3/64', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:06:33'),
(16, NULL, 2, NULL, '⚠️ Geniphone A2mini', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:13:18'),
(17, NULL, 2, NULL, '⚠️ Logicom P197E', 'Soukra — Stock bas: 1 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:15:38'),
(18, NULL, 2, NULL, '⚠️ Realme C61 8/256', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:37:03'),
(19, NULL, 2, NULL, '⚠️ Nokia 105 2024', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:38:04'),
(20, NULL, 2, NULL, '⚠️ Xiaomi Redmi 15C 6/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:49:52'),
(21, NULL, 2, NULL, '⚠️ Vivo Y21D 8/256', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-15 17:52:03'),
(22, NULL, 2, NULL, '⚠️ Redmi 15C 6/128', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-16 11:37:52'),
(23, NULL, 2, NULL, '⚠️ SCOOTER WOLF X2 500W 22 / 23', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-16 11:40:46'),
(24, NULL, 2, NULL, '⚠️ LIKENUO Haut parleur LX01', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-16 12:46:29'),
(25, NULL, 2, NULL, '⚠️ Evertek E28', 'Soukra — ÉPUISÉ', 'danger', 'index.php?page=entree&fid=2', 1, '2026-04-17 11:14:23'),
(26, NULL, 2, NULL, '⚠️ Tecno T101', 'Soukra — Stock bas: 1 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-17 15:00:11'),
(27, NULL, 2, NULL, '⚠️ P9 Normal', 'Soukra — Stock bas: 1 restant(s)', 'warning', 'index.php?page=entree&fid=2', 1, '2026-04-17 15:27:45');

-- --------------------------------------------------------

--
-- Table structure for table `pointages`
--

CREATE TABLE `pointages` (
  `id` int(11) NOT NULL,
  `utilisateur_id` int(11) NOT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `type_pointage` enum('entree','sortie','pause_debut','pause_fin') NOT NULL DEFAULT 'entree',
  `heure` datetime DEFAULT current_timestamp(),
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `adresse` varchar(300) DEFAULT NULL,
  `distance_franchise` int(11) DEFAULT NULL COMMENT 'Distance in meters from franchise',
  `valide` tinyint(4) DEFAULT 1,
  `note` varchar(255) DEFAULT NULL,
  `device_info` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pointages`
--

INSERT INTO `pointages` (`id`, `utilisateur_id`, `franchise_id`, `type_pointage`, `heure`, `latitude`, `longitude`, `adresse`, `distance_franchise`, `valide`, `note`, `device_info`) VALUES
(16, 1, NULL, 'entree', '2026-04-14 11:25:02', '36.8670953', '10.2508448', 'RL 544 طم, Dar Fadhal, معتمدية حلق الوادي, El Aouina, سكرة, معتمدية سكرة, Ariana, 2036, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(17, 1, NULL, 'sortie', '2026-04-14 21:01:49', '36.8637864', '10.2674368', '', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(18, 1, NULL, 'entree', '2026-04-15 10:47:17', '36.8671037', '10.2508245', 'RL 544 طم, Dar Fadhal, معتمدية حلق الوادي, El Aouina, سكرة, معتمدية سكرة, Ariana, 2036, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(19, 1, NULL, 'sortie', '2026-04-15 20:32:00', '36.8637884', '10.2674293', 'Dar Fadhal, Soukra, Délégation Soukra, Gouvernorat Ariana, 2045, Tunisie', NULL, 1, '', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Vers'),
(20, 1, 2, 'entree', '2026-04-16 10:10:45', '36.8668614', '10.2510494', 'RL 544 طم, Dar Fadhal, سكرة, معتمدية سكرة, Ariana, 2036, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(21, 1, 2, 'entree', '2026-04-20 15:52:48', '36.8528836', '10.1596194', 'El Menzah 7, النصر 1, معتمدية أريانة المدينة, Ariana, 7102, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(22, 1, 2, 'pause_debut', '2026-04-20 15:54:32', '36.8529243', '10.1596274', 'El Menzah 7, النصر 1, معتمدية أريانة المدينة, Ariana, 7102, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(23, 1, 2, 'pause_fin', '2026-04-20 15:54:40', '36.8529243', '10.1596274', 'El Menzah 7, النصر 1, معتمدية أريانة المدينة, Ariana, 7102, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(24, 1, 2, 'sortie', '2026-04-20 15:54:44', '36.8529243', '10.1596274', 'El Menzah 7, النصر 1, معتمدية أريانة المدينة, Ariana, 7102, Tunisia', NULL, 1, '', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.'),
(25, 1, 2, 'sortie', '2026-04-22 13:23:14', '36.8670424', '10.2506994', 'RL 544 طم, Dar Fadhal, Délégation La Goulette, El Aouina, Soukra, Délégation Soukra, Gouvernorat Ariana, 2036, Tunisie', NULL, 1, '', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.3'),
(26, 1, 2, 'sortie', '2026-04-22 13:23:44', '36.8670557', '10.2506789', 'RL 544 طم, Dar Fadhal, Délégation La Goulette, El Aouina, Soukra, Délégation Soukra, Gouvernorat Ariana, 2036, Tunisie', NULL, 1, '', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.3'),
(27, 3, 2, 'entree', '2026-04-22 16:57:57', '36.8669838', '10.2507199', 'RL 544 طم, Dar Fadhal, Délégation La Goulette, El Aouina, Soukra, Délégation Soukra, Gouvernorat Ariana, 2036, Tunisie', NULL, 1, '', 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0'),
(28, 2, 1, 'entree', '2026-04-22 17:15:36', '36.8064948', '10.1815316', '29, Avenue du Ghana, Lafayette, Les Jardins, Délégation Bab Bhar, Tunis, Gouvernorat Tunis, 1017, Tunisie', NULL, 1, '', 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0'),
(29, 2, 1, 'sortie', '2026-04-22 17:18:50', '36.8064948', '10.1815316', '29, Avenue du Ghana, Lafayette, Les Jardins, Délégation Bab Bhar, Tunis, Gouvernorat Tunis, 1017, Tunisie', NULL, 1, '', 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0');

-- --------------------------------------------------------

--
-- Table structure for table `points_acces`
--

CREATE TABLE `points_acces` (
  `id` int(11) NOT NULL,
  `nom` varchar(150) NOT NULL,
  `type_point` enum('point_vente','point_recharge','point_acces','depot','kiosque') DEFAULT 'point_vente',
  `type_local` enum('boutique','kiosque','corner','depot','mobile') DEFAULT 'boutique',
  `adresse` text DEFAULT NULL,
  `ville` varchar(100) DEFAULT NULL,
  `code_postal` varchar(10) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `responsable` varchar(100) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `horaires` varchar(200) DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `image_base64` longtext DEFAULT NULL,
  `services_disponibles` text DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1,
  `note` text DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `points_acces`
--

INSERT INTO `points_acces` (`id`, `nom`, `type_point`, `type_local`, `adresse`, `ville`, `code_postal`, `latitude`, `longitude`, `telephone`, `responsable`, `email`, `horaires`, `franchise_id`, `image_base64`, `services_disponibles`, `actif`, `note`, `date_creation`) VALUES
(1, 'a', 'point_vente', 'boutique', 'c', 's', 'e', NULL, NULL, '52750718', 'b', 'admin@rhythmx.tn', '', NULL, NULL, '', 1, '', '2026-04-04 05:35:05'),
(2, 'Dar Fadhal Fedi', 'point_recharge', 'boutique', '', '', '', '36.86364170', '10.24177240', '', '', '', '', 2, NULL, '', 1, '', '2026-04-06 08:51:17'),
(3, 'Dar fadhal Rep', 'point_recharge', 'boutique', '', '', '', '36.86681420', '10.24227560', '', '', '', '', 2, NULL, '', 1, 'Boutique réparation téléphone ', '2026-04-06 09:26:14');

-- --------------------------------------------------------

--
-- Table structure for table `points_reseau`
--

CREATE TABLE `points_reseau` (
  `id` int(11) NOT NULL,
  `nom` varchar(200) NOT NULL,
  `type_point` enum('franchise','activation','recharge','activation_recharge') NOT NULL DEFAULT 'activation_recharge',
  `statut` enum('prospect','contact','contrat_non_signe','contrat_signe','actif','suspendu','resilie') DEFAULT 'prospect',
  `adresse` varchar(255) DEFAULT NULL,
  `ville` varchar(100) DEFAULT NULL,
  `gouvernorat` varchar(100) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `telephone2` varchar(50) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `responsable` varchar(150) DEFAULT NULL,
  `horaires` varchar(255) DEFAULT 'Lun-Sam: 09:00-19:00',
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `notes_internes` text DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL COMMENT 'Linked franchise if type=franchise',
  `date_contact` date DEFAULT NULL,
  `date_contrat` date DEFAULT NULL,
  `date_activation` date DEFAULT NULL,
  `commission_pct` decimal(5,2) DEFAULT 0.00,
  `actif` tinyint(4) DEFAULT 1,
  `cree_par` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp(),
  `date_modification` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `points_reseau`
--

INSERT INTO `points_reseau` (`id`, `nom`, `type_point`, `statut`, `adresse`, `ville`, `gouvernorat`, `telephone`, `telephone2`, `email`, `responsable`, `horaires`, `latitude`, `longitude`, `notes_internes`, `franchise_id`, `date_contact`, `date_contrat`, `date_activation`, `commission_pct`, `actif`, `cree_par`, `date_creation`, `date_modification`) VALUES
(1, 'ASEL Mobile — Mourouj', 'franchise', 'actif', 'Mourouj, Ben Arous', NULL, NULL, '52 123 456', NULL, NULL, 'Gérant Mourouj', 'Lun-Sam: 09:00-19:00', '36.73400000', '10.15470000', NULL, 1, NULL, NULL, NULL, '0.00', 1, NULL, '2026-04-07 04:52:56', '2026-04-07 04:52:56'),
(2, 'ASEL Mobile — Soukra', 'franchise', 'actif', 'Soukra, Ariana', '', '', '47001500', '', '', 'Gérant Soukra', 'Lun-Sam: 09:00-19:00', '36.86717900', '10.25078900', '', 2, NULL, NULL, NULL, '0.00', 1, NULL, '2026-04-07 04:52:56', '2026-04-22 10:26:32'),
(3, 'Boutique FEDI ', 'activation_recharge', 'actif', '', 'Dar fadhal', 'Ariana', '', '', '', 'Fedi', 'Lun-Sam: 09:00-19:00', '36.86364100', '10.24177200', 'Asel pay actif, contrat pas encore signé ', NULL, '2026-04-03', NULL, NULL, '0.00', 1, 1, '2026-04-07 04:53:04', '2026-04-07 04:53:04'),
(4, 'Boutique Réparation Telephones', 'activation_recharge', 'actif', '', 'Dar fadhal', 'Ariana', '', '', '', 'Aymen / Hajer', 'Lun-Sam: 09:00-19:00', '36.86681400', '10.24227500', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-07 04:55:44', '2026-04-08 15:51:59'),
(5, 'Librairie ', 'activation_recharge', 'actif', '', 'dar fadhal', 'Ariana', '', '', '', '', 'Lun-Sam: 09:00-19:00', '36.86300800', '10.24687200', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-07 06:10:47', '2026-04-13 16:03:15'),
(6, 'Helmi', 'recharge', 'prospect', 'Devant hawet', 'Dar fadhal', 'Ariana', '', '', '', 'Helmi', 'Lun-Sam: 09:00-19:00', '36.86578400', '10.25155200', 'Boutique 3attar', NULL, '2026-04-10', NULL, NULL, '0.00', 1, 1, '2026-04-14 11:42:08', '2026-04-14 11:42:30'),
(7, 'Boutique', 'recharge', 'prospect', '', '', '', '', '', '', '', 'Lun-Sam: 09:00-19:00', '36.86511800', '10.25126900', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-16 10:00:37', '2026-04-16 10:00:37'),
(8, 'Boutique weswes', 'recharge', 'prospect', '', '', '', '', '', '', '', 'Lun-Sam: 09:00-19:00', '36.87018800', '10.24872100', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-16 10:01:11', '2026-04-16 10:01:11'),
(9, 'Librairie Imtiaz', 'activation_recharge', 'prospect', '', '', '', '', '', '', '', 'Lun-Sam: 09:00-19:00', '36.87811900', '10.26797900', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-16 10:01:36', '2026-04-16 10:01:36'),
(10, 'Cafe Gaston', 'activation_recharge', 'prospect', '', '', '', '', '', '', 'Ghassen Jridi', 'Lun-Sam: 09:00-19:00', '36.87935000', '10.26107000', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-16 10:02:11', '2026-04-16 10:02:11'),
(11, 'Fedi hamdi', 'activation_recharge', 'actif', 'Dar Fadhal, Délégation Soukra, Gouvernorat Ariana, 2036, Tunisie', 'Ariana', 'Ariana', '56169182', '', '', 'Fedi hamdi', 'Lun-Sam: 09:00-19:00', '36.86194000', '10.24160400', '', NULL, '2026-04-08', NULL, NULL, '10.00', 1, 1, '2026-04-21 17:20:54', '2026-04-21 17:20:54'),
(12, 'Electrosat', 'activation_recharge', 'prospect', '', '', '', '', '', '', '', 'Lun-Sam: 09:00-19:00', '36.87088400', '10.24686100', '', NULL, NULL, NULL, NULL, '0.00', 1, 1, '2026-04-21 17:30:39', '2026-04-21 17:30:39');

-- --------------------------------------------------------

--
-- Table structure for table `prestations`
--

CREATE TABLE `prestations` (
  `id` int(11) NOT NULL,
  `service_id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `client_id` int(11) DEFAULT NULL,
  `prix_facture` decimal(10,2) DEFAULT 0.00,
  `note` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_prestation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `produits`
--

CREATE TABLE `produits` (
  `id` int(11) NOT NULL,
  `nom` varchar(150) NOT NULL,
  `categorie_id` int(11) NOT NULL,
  `prix_achat` decimal(10,2) DEFAULT 0.00,
  `prix_vente` decimal(10,2) DEFAULT 0.00,
  `reference` varchar(50) DEFAULT NULL,
  `code_barre` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `image_base64` mediumtext DEFAULT NULL,
  `marque` varchar(50) DEFAULT NULL,
  `fournisseur_id` int(11) DEFAULT NULL,
  `seuil_alerte` int(11) DEFAULT 3,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp(),
  `tva_rate` decimal(5,2) DEFAULT 19.00,
  `prix_achat_ht` decimal(10,2) DEFAULT 0.00,
  `prix_achat_ttc` decimal(10,2) DEFAULT 0.00,
  `prix_vente_ht` decimal(10,2) DEFAULT 0.00,
  `prix_vente_ttc` decimal(10,2) DEFAULT 0.00,
  `sous_categorie_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `produits`
--

INSERT INTO `produits` (`id`, `nom`, `categorie_id`, `prix_achat`, `prix_vente`, `reference`, `code_barre`, `description`, `image_base64`, `marque`, `fournisseur_id`, `seuil_alerte`, `actif`, `date_creation`, `tva_rate`, `prix_achat_ht`, `prix_achat_ttc`, `prix_vente_ht`, `prix_vente_ttc`, `sous_categorie_id`) VALUES
(1, '2,4A 1M USB micro', 1, '0.00', '0.00', 'BC04M', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(2, 'USB TO type C 1M 3A', 1, '0.00', '0.00', 'BC04C', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(3, 'USB to lightning 1m 3A', 1, '0.00', '0.00', 'BC04L', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(4, 'Type C vers type C PD60W 1m', 1, '0.00', '0.00', 'BC03CC', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(5, 'Type C to Lightning PD 27W 1M', 1, '10.00', '30.00', 'BC03CL', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(6, 'Type C to Lightning 1m', 1, '0.00', '20.00', 'CK-123', '6973143494552', NULL, NULL, 'INKAX', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '16.81', '20.00', NULL),
(7, 'type C 2.4, 1 metre micro', 1, '5.00', '15.00', 'X163', '6972573330959', NULL, NULL, 'WUW', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '12.61', '15.00', NULL),
(8, 'type C 3.0, 1 metre', 1, '5.20', '18.00', 'A102', '6971393457037', NULL, NULL, 'ASPOR', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.37', '5.20', '15.13', '18.00', NULL),
(9, 'type C 2,4, 1 metre', 1, '5.50', '15.00', 'D3T', '6975011278806', NULL, NULL, 'GERLAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.62', '5.50', '12.61', '15.00', NULL),
(10, 'Cable Iphone USB to Iphone 2.1A 1m', 1, '4.80', '15.01', 'XO-NB212', '6920680827848', '', NULL, 'XO', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.03', '4.80', '12.61', '15.01', NULL),
(11, 'Cable iPhone USB to Iphone 2.4A', 1, '5.00', '15.01', 'X163-IP', '6972573332748', '', NULL, 'WUW', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '12.61', '15.01', NULL),
(12, 'iphone 3.1, 1 metre', 1, '5.50', '20.00', 'CB-06-IP', '6973143493159', NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.62', '5.50', '16.81', '20.00', NULL),
(13, 'Cable Iphone USB to Iphone 3 Metres', 1, '10.00', '30.00', 'IC-UC1626', '6291105490597', '', NULL, 'ICONIX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(14, 'Micro 3.1, 1 metre', 1, '5.00', '20.00', 'CB-06-M', '6973143493128', NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '16.81', '20.00', NULL),
(15, 'cable usb-lightning 1m', 1, '5.00', '15.00', 'A1480', NULL, NULL, NULL, 'Apple', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '12.61', '15.00', NULL),
(16, '3,25 FT 3,4A', 1, '7.00', '20.00', 'IC-UC1622', '6291105494045', NULL, NULL, 'ICONIX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '5.88', '7.00', '16.81', '20.00', NULL),
(17, 'TYPE C FAST CHARGING 4,0 MM', 1, '10.00', '30.00', 'CB-45', '6973143492633', NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(18, 'Type C iphone 15+, 1 metre', 1, '10.00', '30.00', 'CK-123-TC', NULL, NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(19, 'Apple originale, 1 metre', 1, '10.00', '45.00', 'MQKJ3ZM/A', '19425349485', NULL, NULL, 'APPLE', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '37.82', '45.00', NULL),
(20, 'Type C, 3,1A 1metre', 1, '10.00', '22.00', 'CB-36', '6975742437732', NULL, NULL, 'Inkax', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '4.62', '10.00', '18.49', '22.00', NULL),
(21, 'Type C iphone, 1 metre 20W', 1, '10.00', '35.00', 'MQGJ2ZM/A', '8503609920110', NULL, NULL, 'Elektrum', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '29.41', '35.00', NULL),
(22, 'cable usb-lightning 1m', 1, '5.00', '15.00', 'AL-32', '6977772577112', NULL, NULL, 'INKAX', 2, 3, 0, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '12.61', '15.00', NULL),
(23, 'USB A 2,4A', 2, '0.00', '25.00', 'BL02', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '21.01', '25.00', NULL),
(24, 'USB-C to lightning 25W iPhone 14 pro', 2, '22.00', '45.00', 'A2347', NULL, NULL, NULL, 'Apple', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '18.49', '22.00', '37.82', '45.00', NULL),
(25, 'USB-C to USB-C 5A 45W white', 2, '0.00', '45.00', 'SAM-45W-W', NULL, NULL, NULL, 'Samsung', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(26, 'USB-C to USB-C 5A 45W black', 2, '0.00', '45.00', 'SAM-45W-B', NULL, NULL, NULL, 'Samsung', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(27, '2,4A 1M USB micro', 2, '0.00', '45.00', 'BL02M', NULL, NULL, NULL, 'Blackwave', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(28, '2,4A 1M USB lightning', 2, '0.00', '45.00', 'BL02L', '', NULL, NULL, 'Blackwave', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(29, 'Sortie type C / USB 35W', 2, '25.00', '50.00', 'S22', NULL, NULL, NULL, 'PD ADAPTER', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '21.01', '25.00', '42.02', '50.00', NULL),
(30, '2.4A avec sortie USB', 2, '10.00', '30.00', 'C06', NULL, NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(31, 'KAKOSIGA 2.4A', 2, '10.00', '30.00', 'KSC-1236', NULL, NULL, NULL, 'KAKOSIGA', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(32, '18W', 2, '18.00', '45.00', 'QC-18W', '786727675973', NULL, NULL, 'ICONIX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '15.13', '18.00', '37.82', '45.00', NULL),
(33, 'Smart charger 2,4A', 2, '10.00', '30.00', 'A818', '6971393452049', NULL, NULL, 'ASPOR', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(34, '2.4 LIGHTING', 2, '10.00', '30.00', 'AG-04', '6975626440209', NULL, NULL, 'AULEX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(35, '30W 2,4A double USB A', 3, '0.00', '0.00', 'CA-27', NULL, NULL, NULL, 'Inkax', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(36, '360 rotating', 3, '0.00', '25.00', 'CH-57', NULL, NULL, NULL, 'INKAX', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '21.01', '25.00', NULL),
(37, '360 rotating retractable', 3, '12.00', '30.00', 'CH-62', NULL, NULL, NULL, 'INKAX', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '10.08', '12.00', '25.21', '30.00', NULL),
(38, 'Metal car mount', 3, '25.00', '45.00', 'HC1508', NULL, NULL, NULL, 'VIDVIE', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '21.01', '25.00', '37.82', '45.00', NULL),
(39, 'Dual USB car MP3 3,1A', 3, '0.00', '30.00', 'C06', '6975742431242', NULL, NULL, 'INKAX', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '25.21', '30.00', NULL),
(40, 'Sortie type C / USB 48W', 3, '18.00', '30.00', 'CA-32', '6975742438760', NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '15.13', '18.00', '25.21', '30.00', NULL),
(41, 'Sortie type C 2,4', 3, '10.00', '30.00', 'CR-69', '6712191102169', NULL, NULL, 'GFUZ', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(42, '1,2m sans ventouse black', 4, '0.00', '20.00', 'E14', NULL, NULL, NULL, 'Inkax', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '16.81', '20.00', NULL),
(43, '1,2m avec ventouse white', 4, '0.00', '20.00', 'E20', NULL, NULL, NULL, 'INKAX', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '16.81', '20.00', NULL),
(44, 'Stereo sans ventouse white', 4, '7.00', '20.00', 'R-3', NULL, NULL, NULL, 'BLUESPECTRUM', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '5.88', '7.00', '16.81', '20.00', NULL),
(45, '1,2m sans ventouse white', 4, '6.00', '15.00', 'G12-W', NULL, NULL, NULL, 'Celebrat', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '5.04', '6.00', '12.61', '15.00', NULL),
(46, '1,2m sans ventouse black', 4, '6.00', '15.00', 'G12-B', NULL, NULL, NULL, 'Celebrat', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '5.04', '6.00', '12.61', '15.00', NULL),
(47, 'Sans ventouse 1,2m white', 4, '0.00', '15.00', 'AE-01-W', NULL, NULL, NULL, 'Inkax', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '12.61', '15.00', NULL),
(48, 'Sans ventouse 1,2m black', 4, '5.00', '15.00', 'AE-01-B', NULL, NULL, NULL, 'Inkax', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '4.20', '5.00', '12.61', '15.00', NULL),
(49, 'Sans ventouse stereo white', 4, '28.00', '0.00', 'EW43', NULL, NULL, NULL, 'HOCO', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '23.53', '28.00', '0.00', '0.00', NULL),
(50, 'Avec ventouse white', 4, '0.00', '45.00', 'T03', NULL, NULL, NULL, 'Inkax', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(51, 'Avec ventouse white HOCO', 4, '0.00', '45.00', 'EW04', NULL, NULL, NULL, 'HOCO', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(52, 'Sans ventouse white', 4, '30.00', '45.00', 'T02', NULL, NULL, NULL, 'Inkax', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '25.21', '30.00', '37.82', '45.00', NULL),
(53, 'ASPORT filaire', 4, '8.00', '22.00', 'A206', '6971393453251', NULL, NULL, 'ASPORT', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '6.72', '8.00', '18.49', '22.00', NULL),
(54, 'R12 Blue Spectrum', 4, '7.00', '18.00', 'R-12', NULL, NULL, NULL, 'Blue Spectrum', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '5.88', '7.00', '15.13', '18.00', NULL),
(55, 'R9 Blue Spectrum', 4, '7.00', '18.00', 'R-09', '', NULL, NULL, 'Blue Spectrum', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '5.88', '7.00', '15.13', '18.00', NULL),
(56, 'ANC Marshal', 4, '25.00', '78.00', 'ANC', '6945648111012', '', NULL, 'Marshal', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '21.01', '25.00', '65.55', '78.00', NULL),
(57, 'XO Wireless earphone', 4, '0.00', '80.00', 'XO-X33', '6920680856763', NULL, NULL, 'XO', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '67.23', '80.00', NULL),
(58, 'INKAX sans ventouse blanc', 4, '0.00', '60.00', 'T02-DF', '6973143493234', NULL, NULL, 'INKAX', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '50.42', '60.00', NULL),
(59, 'Yookie SUPERBASS', 5, '25.00', '70.00', 'gm03', '6971916561111', '', NULL, 'Yookie', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '21.01', '25.00', '58.82', '70.00', NULL),
(60, 'MAJOR IV Wireless', 5, '40.00', '75.00', 'MAJOR-IV', '6920230324018', NULL, NULL, 'Marshal', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '33.61', '40.00', '63.03', '75.00', NULL),
(61, 'P9 Normal', 5, '15.00', '30.00', '16622', '6989532512530', NULL, NULL, 'Generic', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '12.61', '15.00', '25.21', '30.00', NULL),
(62, 'P9 Pro Max', 5, '18.00', '45.00', '20984', '6989532512530', NULL, NULL, 'Generic', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '15.13', '18.00', '37.82', '45.00', NULL),
(63, 'HEADSET SONIC', 5, '0.00', '29.00', 'KR-9900', '0305541899008', NULL, NULL, 'HEADSET', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '24.37', '29.00', NULL),
(64, 'HEADSET KUROMI', 5, '0.00', '29.00', 'AH-806N', '8605541558069', NULL, NULL, 'HEADSET', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '0.00', '0.00', '24.37', '29.00', NULL),
(65, 'Portable wireless speaker I', 12, '55.00', '75.00', 'SLC-061', '', NULL, NULL, 'Wireless', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '46.22', '55.00', '63.03', '75.00', NULL),
(66, 'Wireless speaker bluetooth 5W', 6, '30.00', '45.00', 'JZ-200', '', NULL, NULL, 'Wireless', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '25.21', '30.00', '37.82', '45.00', NULL),
(67, 'BAVIN 5000mAh', 7, '28.00', '45.00', 'PC-013', '6936985012131', NULL, NULL, 'BAVIN', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '23.53', '28.00', '37.82', '45.00', NULL),
(68, 'KAKUSIGA 10000mAh', 7, '25.00', '45.00', 'KSC-1083', '6921042138176', NULL, NULL, 'KAKUSIGA', NULL, 3, 1, '2026-04-03 07:16:57', '19.00', '21.01', '25.00', '37.82', '45.00', NULL),
(69, 'INKAX 10000mAh', 7, '28.00', '55.00', 'PB-01A', NULL, NULL, NULL, 'INKAX', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '23.53', '28.00', '46.22', '55.00', NULL),
(70, 'Holder rearview', 8, '15.00', '35.00', 'KSC-525', '6921042117287', NULL, NULL, 'KAKUSIGA', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '12.61', '15.00', '29.41', '35.00', NULL),
(71, 'Xiaomi Leather Quick Release Strap', 9, '39.00', '50.00', 'ID-53473', '', NULL, NULL, 'Xiaomi', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '32.77', '39.00', '42.02', '50.00', NULL),
(72, 'Xiaomi Leather Quick Release Strap', 9, '39.00', '50.00', 'ID-53472', NULL, NULL, NULL, 'Xiaomi', NULL, 3, 0, '2026-04-03 07:16:57', '19.00', '32.77', '39.00', '42.02', '50.00', NULL),
(73, 'XO Kids Watch', 10, '62.00', '80.00', 'XO-H100', '6920680857487', NULL, NULL, 'XO', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '52.10', '62.00', '67.23', '80.00', NULL),
(74, 'Hainoteko G9 Mini', 10, '100.00', '120.00', 'G9', '6973100642521', NULL, NULL, 'HAINOTEKO', 2, 3, 1, '2026-04-03 07:16:57', '19.00', '84.03', '100.00', '100.84', '120.00', NULL),
(75, 'Honor X5C 4/64', 11, '326.00', '360.00', 'GPS50-HX5C', NULL, NULL, NULL, 'Honor', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '273.95', '326.00', '302.52', '360.00', NULL),
(76, 'Honor X5C plus 4/128', 11, '357.00', '420.00', 'GPS50-HX5CP', '', '', NULL, 'Honor', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '300.00', '357.00', '352.94', '420.00', NULL),
(77, 'Honor X6C 6/128', 11, '421.00', '495.00', 'GPS50-HX6C', NULL, NULL, NULL, 'Honor', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '353.78', '421.00', '415.97', '495.00', NULL),
(78, 'Realme C61 8/256', 11, '516.00', '570.00', 'GPS50-RC61', NULL, NULL, NULL, 'Realme', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '433.61', '516.00', '478.99', '570.00', NULL),
(79, 'Realme Note 60X 3/64', 11, '281.99', '320.00', 'GPS50-RN60X', NULL, NULL, NULL, 'Realme', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '236.97', '281.99', '268.91', '320.00', NULL),
(80, 'Xiaomi Redmi 13 6/128', 11, '470.00', '550.02', 'GPS50-XR13', '', '', NULL, 'Xiaomi', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '394.96', '470.00', '462.20', '550.02', NULL),
(81, 'Xiaomi Redmi 15C 4/128', 11, '404.01', '450.00', 'GPS50-XR15C4', '', '', NULL, 'Xiaomi', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '339.50', '404.01', '378.15', '450.00', NULL),
(82, 'Xiaomi Redmi 15C 6/128', 11, '441.00', '495.00', 'GPS50-XR15C6', NULL, NULL, NULL, 'Xiaomi', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '370.59', '441.00', '415.97', '495.00', NULL),
(83, 'Xiaomi Redmi A5 3/64', 11, '272.00', '350.00', 'GPS50-XRA5', NULL, NULL, NULL, 'Xiaomi', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '228.57', '272.00', '294.12', '350.00', NULL),
(84, 'Samsung A07 4/64', 11, '355.00', '399.00', 'GPS50-SA07', NULL, NULL, NULL, 'Samsung', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '298.32', '355.00', '335.29', '399.00', NULL),
(85, 'Vivo Y04 4/64', 11, '314.01', '380.00', 'GPS50-VY04', NULL, NULL, NULL, 'Vivo', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '263.87', '314.01', '319.33', '380.00', NULL),
(86, 'Evertek E28', 11, '62.50', '69.00', 'EVR-E28', '6975020870459', '', NULL, 'Evertek', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '52.52', '62.50', '57.98', '69.00', NULL),
(87, 'Geniphone A2mini', 11, '37.90', '45.00', 'GEN-A2M', NULL, NULL, NULL, 'Geniphone', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '31.85', '37.90', '37.82', '45.00', NULL),
(88, 'Logicom P197E', 11, '37.50', '45.00', 'LOG-P197E', NULL, NULL, NULL, 'Logicom', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '31.51', '37.50', '37.82', '45.00', NULL),
(89, 'Nokia 105 2024', 11, '54.39', '65.00', 'NOK-105', NULL, NULL, NULL, 'Nokia', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '45.71', '54.39', '54.62', '65.00', NULL),
(90, 'Samsung A04 3/32', 11, '412.00', '455.00', 'SAM-A04', NULL, NULL, NULL, 'Samsung', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '346.22', '412.00', '382.35', '455.00', NULL),
(91, 'Samsung A04 S 4/128', 11, '495.40', '545.00', 'SAM-A04S', NULL, NULL, NULL, 'Samsung', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '416.30', '495.40', '457.98', '545.00', NULL),
(92, 'Samsung Galaxy A14 4/128', 11, '487.00', '540.00', 'SAM-A14', NULL, NULL, NULL, 'Samsung', 1, 3, 1, '2026-04-03 07:16:57', '19.00', '409.24', '487.00', '453.78', '540.00', NULL),
(94, 'Likenuo Wireless Soundbar', 12, '0.00', '42.00', 'lx-01', '6918033881425', NULL, NULL, 'Likenuo', NULL, 3, 1, '2026-04-07 05:06:45', '19.00', '0.00', '0.00', '35.29', '42.00', NULL),
(95, 'USB Speaker', 12, '0.00', '35.00', 'v310', '6970171740675', NULL, NULL, 'Kisonli', NULL, 3, 1, '2026-04-07 05:08:02', '19.00', '0.00', '0.00', '29.41', '35.00', NULL),
(96, 'TUCCI Headphone', 5, '0.00', '0.00', 'TC-L770MV', '6972667897702', NULL, NULL, 'TUCCI', NULL, 3, 0, '2026-04-07 05:09:41', '19.00', '0.00', '0.00', '0.00', '0.00', NULL),
(97, 'MOBILE MULTIMÉDIA SPEAKER', 12, '0.00', '120.00', 'ms-2042bt', '', NULL, NULL, 'rgb', NULL, 3, 0, '2026-04-07 05:11:22', '19.00', '0.00', '0.00', '100.84', '120.00', NULL),
(98, 'Kisonli USB Speaker', 12, '0.00', '35.00', 'v310', '6970171740675', NULL, NULL, 'kisonli', NULL, 3, 1, '2026-04-08 03:25:22', '19.00', '0.00', '0.00', '29.41', '35.00', NULL),
(99, 'Charger single port fast charger', 3, '0.00', '30.00', 'Q/HHDZ', '6921042140049', NULL, NULL, 'KAKUSIGA', NULL, 3, 1, '2026-04-08 06:39:44', '19.00', '0.00', '0.00', '25.21', '30.00', NULL),
(100, 'XO USB IPHONE', 1, '4.76', '15.01', 'XO-JQ-C1', '6920680829064', '', NULL, 'XO', NULL, 3, 1, '2026-04-08 07:33:39', '19.00', '4.00', '4.76', '12.61', '15.01', NULL),
(101, 'Portable wireless speaker ', 12, '0.00', '45.00', 'Lx-11', '6800287961001', NULL, NULL, 'Likenuo', NULL, 3, 1, '2026-04-09 08:09:31', '19.00', '0.00', '0.00', '37.82', '45.00', NULL),
(102, 'Wirless earbuds', 4, '25.00', '49.00', 'Yks18', '6971916568301', NULL, NULL, 'Yookie', NULL, 3, 1, '2026-04-09 08:18:28', '19.00', '21.01', '25.00', '41.18', '49.00', NULL),
(103, 'Portable loudspeaker ', 12, '35.00', '60.00', 'C15', '6800901550567', NULL, NULL, 'Original', NULL, 3, 1, '2026-04-09 08:23:48', '19.00', '29.41', '35.00', '50.42', '60.00', NULL),
(104, 'Cable micro 2.4 1m', 1, '5.00', '12.50', 'X163-MC', NULL, NULL, NULL, 'WUW', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '4.20', '5.00', '10.50', '12.50', NULL),
(105, 'Cable type c 3.0A 1m', 1, '5.20', '12.99', 'A102', '', '', NULL, 'ASPOR', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '4.37', '5.20', '10.92', '12.99', NULL),
(106, 'Cable micro 3.1 1m', 1, '5.50', '20.00', 'CB-06-MC', '', '', NULL, 'INKAX', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '4.62', '5.50', '16.81', '20.00', NULL),
(107, 'Cable type-c type-c inkax', 1, '10.00', '25.00', 'CK-123', NULL, NULL, NULL, 'INKAX', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '8.40', '10.00', '21.01', '25.00', NULL),
(108, 'Cable aux aux inkax', 1, '5.00', '15.01', 'AL 32', '6977772577112', '', NULL, 'INKAX', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '4.20', '5.00', '12.61', '15.01', NULL),
(109, 'Tete chargeur original iPhone', 2, '20.00', '50.00', 'TETE-IPH', NULL, NULL, NULL, 'APPLE', NULL, 3, 1, '2026-04-13 08:59:04', '19.00', '16.81', '20.00', '42.02', '50.00', NULL),
(110, 'Chargeur Asport', 2, '10.00', '25.00', 'CHG-ASP', NULL, NULL, NULL, 'ASPOR', NULL, 3, 1, '2026-04-13 08:59:05', '19.00', '8.40', '10.00', '21.01', '25.00', NULL),
(111, 'Chargeur Iconix 18W', 2, '18.00', '45.00', 'QC 18W', NULL, NULL, NULL, 'ICONIX', NULL, 3, 1, '2026-04-13 08:59:05', '19.00', '15.13', '18.00', '37.82', '45.00', NULL),
(112, 'Chargeur micro', 2, '10.00', '25.00', 'CHG-MICRO', NULL, NULL, NULL, '', NULL, 3, 1, '2026-04-13 08:59:05', '19.00', '8.40', '10.00', '21.01', '25.00', NULL),
(113, 'Chargeur iPhone', 2, '10.00', '25.00', 'CHG-IPH', NULL, NULL, NULL, '', NULL, 3, 1, '2026-04-13 08:59:05', '19.00', '8.40', '10.00', '21.01', '25.00', NULL),
(114, 'Chargeur Alex', 2, '10.00', '30.00', 'CHG-ALEX', '', '', NULL, 'AULEX', NULL, 3, 1, '2026-04-13 08:59:05', '19.00', '8.40', '10.00', '25.21', '30.00', NULL),
(115, 'Kit ecouteur R12', 4, '7.00', '15.01', 'R 12', '', '', NULL, 'BLUE SPECTRE', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '5.88', '7.00', '12.61', '15.01', NULL),
(116, 'Kit ecouteur R9', 4, '7.00', '17.50', 'R 09', NULL, NULL, NULL, 'BLUE SPECTRE', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '5.88', '7.00', '14.71', '17.50', NULL),
(117, 'Allume cigare 48W inkax', 2, '18.00', '45.00', 'CA 32', NULL, NULL, NULL, 'INKAX', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '15.13', '18.00', '37.82', '45.00', NULL),
(118, 'Casque Marshall wireless', 5, '40.00', '75.01', 'MAJOR IV', '6920230324018', '', NULL, 'MARSHAL', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '33.61', '40.00', '63.03', '75.01', NULL),
(119, 'Casque Kids', 5, '20.00', '50.00', 'CASQ-KIDS', NULL, NULL, NULL, '', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '16.81', '20.00', '42.02', '50.00', NULL),
(120, 'Power Bank Bavin 5000mAh', 7, '28.00', '70.00', 'PC 013', NULL, NULL, NULL, 'BAVIN', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '23.53', '28.00', '58.82', '70.00', NULL),
(121, 'Power Bank Inkax 10000mAh', 7, '28.00', '70.00', 'PB-01A', NULL, NULL, NULL, 'INKAX', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '23.53', '28.00', '58.82', '70.00', NULL),
(122, 'Power Bank Kakusiga 10000mAh', 7, '25.00', '62.50', 'KSC 1083', '6921042138176', '', NULL, 'KAKUSIGA', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '21.01', '25.00', '52.52', '62.50', NULL),
(123, 'Haut parleur 2043', 17, '80.00', '200.00', 'HP-2043', NULL, NULL, NULL, '', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '67.23', '80.00', '168.07', '200.00', NULL),
(124, 'LIKENUO Haut parleur LX01', 17, '27.00', '50.00', 'LX01', '', '', NULL, 'LIKENUO', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '22.69', '27.00', '42.02', '50.00', NULL),
(125, 'LIKENUO Haut parleur LX11', 17, '30.00', '45.01', 'LX11', '', '', NULL, 'LIKENUO', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '25.21', '30.00', '37.82', '45.01', NULL),
(126, 'Haut parleur 905 Boom Box', 17, '40.00', '65.00', '905', '', '', NULL, '', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '33.61', '40.00', '54.62', '65.00', NULL),
(127, 'Haut parleur Kisoni PC', 17, '20.00', '50.00', 'KISONI', NULL, NULL, NULL, 'KISONI', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '16.81', '20.00', '42.02', '50.00', NULL),
(128, 'Support voiture Kakusiga', 18, '15.01', '35.00', 'KSC 525', '6921042117287', '', NULL, 'KAKUSIGA', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '12.61', '15.01', '29.41', '35.00', NULL),
(129, 'Support accessoires', 18, '1.79', '0.00', 'SUPPORT-ACC', '', '', NULL, '', 2, 3, 1, '2026-04-13 09:05:36', '19.00', '1.50', '1.79', '0.00', '0.00', NULL),
(130, 'Kit Bluetooth voiture', 18, '40.00', '100.00', 'KIT-BT', '', '', NULL, '', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '33.61', '40.00', '84.03', '100.00', NULL),
(131, 'Casque PC TUCCI TC-L770MV', 5, '35.00', '70.00', 'Tc-l770mv', '6972667897702', '', NULL, 'Tucci', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '29.41', '35.00', '58.82', '70.00', NULL),
(132, 'Coque Silicon telephone', 19, '6.50', '16.25', 'SILICON', NULL, NULL, NULL, '', NULL, 3, 1, '2026-04-13 09:05:36', '19.00', '5.46', '6.50', '13.66', '16.25', NULL),
(134, 'TROTINETTE SPIDER MAX 500W', 20, '900.00', '1250.00', 'trotinette', '', 'TROTINETTE SPIDER MAX 500 W 25070097 / 25070098 / 25070099 / 25070100 / 25070101', NULL, 'Spider', 3, 3, 1, '2026-04-13 09:52:35', '7.00', '841.12', '900.00', '1168.22', '1250.00', NULL),
(135, 'SCOOTER WOLF X2 500W 22 / 23', 20, '1700.01', '2250.00', 'scooter-bicyclette', '', '', NULL, 'wolf', 3, 1, 1, '2026-04-13 09:53:31', '7.00', '1588.79', '1700.01', '2102.80', '2250.00', NULL),
(136, 'Tablette Infinix 8/256', 11, '425.00', '550.00', 'tab-infinix', '', '', NULL, 'infinix', 4, 3, 1, '2026-04-15 12:35:27', '7.00', '397.20', '425.00', '514.02', '550.00', NULL),
(137, 'Tecno T101', 11, '44.01', '65.00', '', '', '', NULL, 'Tecno', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '36.98', '44.01', '54.62', '65.00', NULL),
(138, 'Lava Gem Power', 11, '57.00', '80.00', '', '', '', NULL, 'Lava', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '47.90', '57.00', '67.23', '80.00', NULL),
(139, 'Lava A1 Vibe', 11, '33.00', '52.00', '', '', '', NULL, 'Lava', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '27.73', '33.00', '43.70', '52.00', NULL),
(140, 'iPro A1', 11, '33.00', '52.00', '', '', '', NULL, 'iPro', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '27.73', '33.00', '43.70', '52.00', NULL),
(141, 'Nokia A6', 11, '47.60', '54.74', '', '', '', NULL, 'Nokia', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '40.00', '47.60', '46.00', '54.74', NULL),
(142, 'IPRO A1', 11, '33.00', '37.95', 'ipro-a1', '', '', NULL, 'IPRO', 4, 1, 0, '2026-04-15 13:00:58', '19.00', '27.73', '33.00', '31.89', '37.95', NULL),
(143, 'Vivo Y21D 8/256', 11, '500.00', '575.00', '', '', '', NULL, 'Vivo', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '420.17', '500.00', '483.19', '575.00', NULL),
(144, 'Alcatel A31 Pro NC', 11, '265.00', '304.75', '', '', '', NULL, 'Alcatel', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '222.69', '265.00', '256.09', '304.75', NULL),
(145, 'Itel A90', 11, '264.99', '330.00', '', '', '', NULL, 'Itel', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '222.68', '264.99', '277.31', '330.00', NULL),
(146, 'Itel A50C 64G', 11, '240.00', '276.00', '', '', '', NULL, 'Itel', 4, 1, 1, '2026-04-15 13:00:58', '19.00', '201.68', '240.00', '231.93', '276.00', NULL),
(147, 'Redmi 15C 6/128', 11, '429.99', '620.00', 'redmi-15c-6-128', '', '', NULL, 'Infinix', 4, 1, 1, '2026-04-15 13:28:17', '19.00', '361.34', '429.99', '521.01', '620.00', NULL),
(148, 'Honor Play 10 3/64', 11, '280.00', '360.00', 'honor-play-10-3-64', '', '', NULL, 'Honor', 4, 3, 1, '2026-04-15 13:56:02', '19.00', '235.29', '280.00', '302.52', '360.00', NULL),
(149, 'Vivo Y04 4/128', 11, '345.00', '0.00', '', '', '', NULL, 'VIVO', 4, 3, 1, '2026-04-15 13:57:14', '19.00', '289.92', '345.00', '0.00', '0.00', NULL),
(150, 'Ecouteurs sans fil', 4, '40.00', '60.00', 't02', '6973143493234', '', NULL, 'inkax', 2, 3, 1, '2026-04-15 16:07:03', '19.00', '33.61', '40.00', '50.42', '60.00', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `produits_asel`
--

CREATE TABLE `produits_asel` (
  `id` int(11) NOT NULL,
  `nom` varchar(150) NOT NULL,
  `type_produit` enum('recharge_solde','recharge_internet','carte_sim','autre') NOT NULL,
  `operateur` varchar(50) DEFAULT NULL,
  `valeur_nominale` decimal(10,2) DEFAULT 0.00,
  `prix_vente` decimal(10,2) DEFAULT 0.00,
  `commission` decimal(10,2) DEFAULT 0.00,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `produits_asel`
--

INSERT INTO `produits_asel` (`id`, `nom`, `type_produit`, `operateur`, `valeur_nominale`, `prix_vente`, `commission`, `actif`, `date_creation`) VALUES
(41, 'Carte SIM ASEL Mobile', 'carte_sim', 'ASEL', '2.50', '2.50', '1.00', 1, '2026-04-03 10:31:12'),
(42, 'Recharge ASEL 1 DT', 'recharge_solde', 'ASEL', '1.00', '1.00', '0.05', 1, '2026-04-03 10:31:12'),
(43, 'Recharge ASEL 2 DT', 'recharge_solde', 'ASEL', '2.00', '2.00', '0.10', 1, '2026-04-03 10:31:12'),
(44, 'Recharge ASEL 3 DT', 'recharge_solde', 'ASEL', '3.00', '3.00', '0.15', 1, '2026-04-03 10:31:12'),
(45, 'Recharge ASEL 5 DT', 'recharge_solde', 'ASEL', '5.00', '5.00', '0.25', 1, '2026-04-03 10:31:12'),
(46, 'Recharge ASEL 10 DT', 'recharge_solde', 'ASEL', '10.00', '10.00', '0.50', 1, '2026-04-03 10:31:12'),
(47, 'Recharge ASEL 20 DT', 'recharge_solde', 'ASEL', '20.00', '20.00', '1.00', 1, '2026-04-03 10:31:12'),
(48, 'Recharge ASEL 50 DT', 'recharge_solde', 'ASEL', '50.00', '50.00', '2.50', 1, '2026-04-03 10:31:12'),
(49, 'ASEL 1Go / 1 jour', 'recharge_internet', 'ASEL', '1.00', '1.00', '0.05', 1, '2026-04-03 10:31:12'),
(50, 'ASEL 1Go / 3 jours', 'recharge_internet', 'ASEL', '2.00', '2.00', '0.10', 1, '2026-04-03 10:31:12'),
(51, 'ASEL 3Go / 7 jours', 'recharge_internet', 'ASEL', '5.00', '5.00', '0.25', 1, '2026-04-03 10:31:12'),
(52, 'ASEL 5Go / 15 jours', 'recharge_internet', 'ASEL', '8.00', '8.00', '0.40', 1, '2026-04-03 10:31:12'),
(53, 'ASEL 10Go / 30 jours', 'recharge_internet', 'ASEL', '15.00', '15.00', '0.75', 1, '2026-04-03 10:31:12'),
(54, 'ASEL 20Go / 30 jours', 'recharge_internet', 'ASEL', '25.00', '25.00', '1.25', 1, '2026-04-03 10:31:12'),
(55, 'ASEL 50Go / 30 jours', 'recharge_internet', 'ASEL', '40.00', '40.00', '2.00', 1, '2026-04-03 10:31:12'),
(56, 'ASEL Illimité / 30 jours', 'recharge_internet', 'ASEL', '60.00', '60.00', '3.00', 1, '2026-04-03 10:31:12');

-- --------------------------------------------------------

--
-- Table structure for table `produit_fournisseurs`
--

CREATE TABLE `produit_fournisseurs` (
  `id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `fournisseur_id` int(11) NOT NULL,
  `prix_achat_ht` decimal(12,2) DEFAULT 0.00,
  `prix_achat_ttc` decimal(12,2) DEFAULT 0.00,
  `reference_fournisseur` varchar(50) DEFAULT '',
  `is_default` tinyint(1) DEFAULT 0,
  `date_derniere_commande` date DEFAULT NULL,
  `notes` varchar(255) DEFAULT '',
  `actif` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `produit_fournisseurs`
--

INSERT INTO `produit_fournisseurs` (`id`, `produit_id`, `fournisseur_id`, `prix_achat_ht`, `prix_achat_ttc`, `reference_fournisseur`, `is_default`, `date_derniere_commande`, `notes`, `actif`, `created_at`) VALUES
(1, 7, 2, '4.20', '5.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(2, 8, 2, '4.37', '5.20', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(3, 9, 2, '4.62', '5.50', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(4, 10, 2, '4.03', '4.80', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(5, 11, 2, '4.20', '5.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(6, 12, 2, '4.62', '5.50', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(7, 13, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(8, 14, 2, '4.20', '5.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(9, 16, 2, '5.88', '7.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(10, 17, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(11, 18, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(12, 19, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(13, 20, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(14, 21, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(15, 22, 2, '4.20', '5.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(16, 30, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(17, 31, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(18, 32, 2, '15.13', '18.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(19, 33, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(20, 34, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(21, 40, 2, '15.13', '18.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(22, 41, 2, '8.40', '10.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(23, 53, 2, '6.72', '8.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(24, 54, 2, '5.88', '7.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(25, 55, 2, '5.88', '7.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(26, 57, 2, '0.00', '0.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(27, 58, 2, '0.00', '0.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(28, 60, 2, '33.61', '40.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(29, 61, 2, '12.61', '15.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(30, 62, 2, '15.13', '18.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(31, 70, 2, '12.61', '15.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(32, 73, 2, '52.10', '62.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(33, 74, 2, '84.03', '100.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(34, 75, 1, '273.95', '326.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(35, 76, 1, '300.00', '357.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(36, 77, 1, '353.78', '421.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(37, 78, 1, '433.61', '516.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(38, 79, 1, '236.97', '281.99', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(39, 80, 1, '394.96', '470.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(40, 81, 1, '339.50', '404.01', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(41, 82, 1, '370.59', '441.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(42, 83, 1, '228.57', '272.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(43, 84, 1, '298.32', '355.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(44, 85, 1, '263.87', '314.01', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(45, 86, 1, '52.52', '62.50', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(46, 87, 1, '31.85', '37.90', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(47, 88, 1, '31.51', '37.50', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(48, 89, 1, '45.71', '54.39', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(49, 90, 1, '346.22', '412.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(50, 91, 1, '416.30', '495.40', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(51, 92, 1, '409.24', '487.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(52, 134, 3, '841.12', '900.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(53, 135, 3, '1588.79', '1700.01', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(54, 136, 4, '397.20', '425.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(55, 137, 4, '36.98', '44.01', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(56, 138, 4, '47.90', '57.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(57, 139, 4, '27.73', '33.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(58, 140, 4, '27.73', '33.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(59, 141, 4, '40.00', '47.60', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(60, 142, 4, '27.73', '33.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(61, 143, 4, '420.17', '500.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(62, 144, 4, '222.69', '265.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(63, 145, 4, '222.68', '264.99', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(64, 146, 4, '201.68', '240.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(65, 147, 4, '361.34', '429.99', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(66, 148, 4, '235.29', '280.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(67, 149, 4, '289.92', '345.00', '', 1, NULL, '', 1, '2026-04-15 13:25:29'),
(69, 59, 2, '21.01', '25.00', 'Mokhtar', 1, NULL, '', 1, '2026-04-16 12:34:20');

-- --------------------------------------------------------

--
-- Table structure for table `retours`
--

CREATE TABLE `retours` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite` int(11) NOT NULL,
  `type_retour` enum('retour','echange') DEFAULT 'retour',
  `raison` text DEFAULT NULL,
  `note` text DEFAULT NULL,
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_retour` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `services`
--

CREATE TABLE `services` (
  `id` int(11) NOT NULL,
  `nom` varchar(150) NOT NULL,
  `categorie_service` enum('technique','compte','autre') DEFAULT 'technique',
  `prix` decimal(10,2) DEFAULT 0.00,
  `description` text DEFAULT NULL,
  `duree_minutes` int(11) DEFAULT 15,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `services`
--

INSERT INTO `services` (`id`, `nom`, `categorie_service`, `prix`, `description`, `duree_minutes`, `actif`, `date_creation`) VALUES
(1, 'Création compte Google', 'compte', '10.00', 'Création et configuration Gmail', 15, 1, '2026-04-03 10:16:36'),
(2, 'Création compte iCloud', 'compte', '15.00', 'Création Apple ID + iCloud', 20, 1, '2026-04-03 10:16:36'),
(3, 'Création compte Samsung', 'compte', '10.00', 'Compte Samsung Galaxy', 10, 1, '2026-04-03 10:16:36'),
(4, 'Transfert de données', 'technique', '20.00', 'Transfert contacts, photos, apps', 30, 1, '2026-04-03 10:16:36'),
(5, 'Formatage téléphone', 'technique', '15.00', 'Reset usine + reconfiguration', 20, 1, '2026-04-03 10:16:36'),
(6, 'Installation applications', 'technique', '10.00', 'Installation et config apps', 15, 1, '2026-04-03 10:16:36'),
(7, 'Réparation écran', 'technique', '0.00', 'Devis selon modèle', 60, 1, '2026-04-03 10:16:36'),
(8, 'Déverrouillage FRP', 'technique', '30.00', 'Suppression verrou Google', 30, 1, '2026-04-03 10:16:36'),
(9, 'Mise à jour logicielle', 'technique', '10.00', 'Mise à jour OS', 20, 1, '2026-04-03 10:16:36'),
(10, 'Configuration email pro', 'compte', '15.00', 'Config Outlook/Exchange', 15, 1, '2026-04-03 10:16:36'),
(11, 'Sauvegarde données', 'technique', '15.00', 'Backup complet cloud/local', 20, 1, '2026-04-03 10:16:36'),
(12, 'Protection antivirus', 'technique', '10.00', 'Installation + config antivirus', 10, 1, '2026-04-03 10:16:36');

-- --------------------------------------------------------

--
-- Table structure for table `sous_categories`
--

CREATE TABLE `sous_categories` (
  `id` int(11) NOT NULL,
  `nom` varchar(100) NOT NULL,
  `categorie_id` int(11) NOT NULL,
  `description` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stock`
--

CREATE TABLE `stock` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite` int(11) DEFAULT 0,
  `derniere_maj` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `stock`
--

INSERT INTO `stock` (`id`, `franchise_id`, `produit_id`, `quantite`, `derniere_maj`) VALUES
(1, 2, 7, 10, '2026-04-13 09:58:26'),
(2, 2, 8, 5, '2026-04-15 15:42:51'),
(3, 2, 9, 7, '2026-04-15 15:42:51'),
(4, 2, 10, 9, '2026-04-15 15:42:51'),
(5, 2, 11, 7, '2026-04-15 15:42:51'),
(6, 2, 12, 10, '2026-04-13 09:58:26'),
(7, 2, 13, 4, '2026-04-15 15:42:51'),
(8, 2, 104, 5, '2026-04-13 09:58:26'),
(9, 2, 105, 5, '2026-04-13 09:58:26'),
(10, 2, 106, 4, '2026-04-15 15:42:51'),
(11, 2, 16, 5, '2026-04-13 09:58:26'),
(12, 2, 17, 5, '2026-04-13 09:58:26'),
(13, 2, 107, 3, '2026-04-15 15:53:27'),
(14, 2, 19, 5, '2026-04-13 09:58:26'),
(15, 2, 20, 7, '2026-04-20 17:02:49'),
(16, 2, 21, 5, '2026-04-13 09:58:26'),
(17, 2, 108, 5, '2026-04-13 09:58:26'),
(18, 2, 29, 4, '2026-04-15 15:42:51'),
(19, 2, 109, 5, '2026-04-13 09:58:26'),
(20, 2, 33, 4, '2026-04-15 15:42:51'),
(21, 2, 30, 5, '2026-04-13 09:58:26'),
(22, 2, 31, 5, '2026-04-13 09:58:26'),
(23, 2, 34, 4, '2026-04-15 15:42:51'),
(24, 2, 110, 5, '2026-04-13 09:58:26'),
(25, 2, 111, 5, '2026-04-13 09:58:26'),
(26, 2, 112, 5, '2026-04-13 09:58:26'),
(27, 2, 113, 5, '2026-04-13 09:58:26'),
(28, 2, 114, 5, '2026-04-13 09:58:26'),
(29, 2, 53, 5, '2026-04-13 09:58:26'),
(30, 2, 115, 1, '2026-04-15 16:26:33'),
(31, 2, 116, 5, '2026-04-13 09:58:26'),
(32, 2, 117, 2, '2026-04-13 09:58:26'),
(33, 2, 41, 2, '2026-04-13 09:58:26'),
(34, 2, 118, 2, '2026-04-13 09:58:26'),
(35, 2, 61, 1, '2026-04-17 15:27:45'),
(36, 2, 62, 2, '2026-04-13 09:58:27'),
(37, 2, 119, 2, '2026-04-13 09:58:27'),
(38, 2, 120, 2, '2026-04-13 09:58:27'),
(39, 2, 121, 2, '2026-04-13 09:58:27'),
(40, 2, 122, 2, '2026-04-13 09:58:27'),
(41, 2, 73, 1, '2026-04-13 09:58:27'),
(42, 2, 74, 1, '2026-04-13 09:58:27'),
(43, 2, 123, 1, '2026-04-13 09:58:27'),
(44, 2, 124, 0, '2026-04-16 12:46:29'),
(45, 2, 125, 1, '2026-04-13 09:58:27'),
(46, 2, 126, 0, '2026-04-15 16:26:33'),
(47, 2, 103, 0, '2026-04-15 16:26:33'),
(48, 2, 127, 1, '2026-04-13 09:58:27'),
(49, 2, 128, 2, '2026-04-13 09:58:27'),
(50, 2, 129, 100, '2026-04-13 09:58:27'),
(51, 2, 130, 2, '2026-04-13 09:58:27'),
(52, 2, 131, 1, '2026-04-13 09:58:27'),
(53, 2, 102, 1, '2026-04-13 09:58:27'),
(54, 2, 132, 135, '2026-04-13 09:58:27'),
(55, 3, 134, 3, '2026-04-13 10:07:36'),
(56, 3, 135, 1, '2026-04-13 10:07:19'),
(57, 2, 135, 0, '2026-04-16 11:40:46'),
(58, 2, 134, 1, '2026-04-15 16:51:13'),
(59, 2, 86, 0, '2026-04-17 15:12:59'),
(60, 2, 87, 0, '2026-04-15 17:13:18'),
(61, 2, 88, 1, '2026-04-15 17:15:38'),
(62, 2, 89, 0, '2026-04-15 17:38:04'),
(63, 2, 75, 0, '2026-04-15 17:01:54'),
(64, 2, 76, 0, '2026-04-15 16:42:30'),
(65, 2, 77, 0, '2026-04-15 17:04:53'),
(66, 2, 78, 0, '2026-04-15 17:37:03'),
(67, 2, 79, 0, '2026-04-15 16:52:27'),
(68, 2, 80, 0, '2026-04-15 17:00:32'),
(69, 2, 81, 0, '2026-04-15 16:46:05'),
(70, 2, 82, 0, '2026-04-15 17:49:52'),
(71, 2, 83, 0, '2026-04-15 17:06:33'),
(72, 2, 91, 1, '2026-04-14 14:04:45'),
(73, 2, 84, 1, '2026-04-14 14:04:45'),
(74, 2, 92, 0, '2026-04-15 17:42:35'),
(75, 2, 85, 1, '2026-04-14 14:04:45'),
(76, 1, 136, 0, '2026-04-15 12:35:27'),
(77, 2, 136, 0, '2026-04-15 12:35:27'),
(78, 3, 136, 1, '2026-04-15 14:06:07'),
(79, 1, 137, 0, '2026-04-15 13:00:58'),
(80, 2, 137, 1, '2026-04-17 15:00:11'),
(81, 3, 137, 1, '2026-04-15 14:41:26'),
(82, 1, 138, 0, '2026-04-15 13:00:58'),
(83, 2, 138, 1, '2026-04-15 14:41:14'),
(84, 3, 138, 1, '2026-04-15 14:41:14'),
(85, 1, 139, 0, '2026-04-15 13:00:58'),
(86, 2, 139, 1, '2026-04-15 14:41:06'),
(87, 3, 139, 2, '2026-04-15 14:41:06'),
(88, 1, 140, 0, '2026-04-15 07:14:17'),
(89, 2, 140, 2, '2026-04-15 14:41:53'),
(90, 3, 140, 1, '2026-04-15 07:13:39'),
(91, 1, 141, 0, '2026-04-15 13:00:58'),
(92, 2, 141, 0, '2026-04-15 13:00:58'),
(93, 3, 141, 0, '2026-04-15 13:00:58'),
(94, 1, 142, 0, '2026-04-15 13:00:58'),
(95, 2, 142, 0, '2026-04-15 13:00:58'),
(96, 3, 142, 0, '2026-04-15 13:00:58'),
(97, 1, 143, 0, '2026-04-15 13:00:58'),
(98, 2, 143, 0, '2026-04-15 17:52:03'),
(99, 3, 143, 0, '2026-04-15 14:40:24'),
(100, 1, 144, 0, '2026-04-15 13:00:58'),
(101, 2, 144, 1, '2026-04-15 14:42:20'),
(102, 3, 144, 1, '2026-04-15 14:42:20'),
(103, 1, 145, 0, '2026-04-15 13:00:58'),
(104, 2, 145, 0, '2026-04-15 17:00:32'),
(105, 3, 145, 0, '2026-04-15 16:57:46'),
(106, 1, 146, 0, '2026-04-15 13:00:58'),
(107, 2, 146, 0, '2026-04-15 13:00:58'),
(108, 3, 146, 1, '2026-04-15 14:06:07'),
(109, 4, 7, 0, '2026-04-15 13:04:29'),
(110, 4, 8, 0, '2026-04-15 13:04:29'),
(111, 4, 9, 0, '2026-04-15 13:04:29'),
(112, 4, 10, 0, '2026-04-15 13:04:29'),
(113, 4, 11, 0, '2026-04-15 13:04:29'),
(114, 4, 12, 0, '2026-04-15 13:04:29'),
(115, 4, 13, 0, '2026-04-15 13:04:29'),
(116, 4, 14, 0, '2026-04-15 13:04:29'),
(117, 2, 15, 4, '2026-04-15 15:53:27'),
(118, 4, 16, 0, '2026-04-15 13:04:29'),
(119, 4, 17, 0, '2026-04-15 13:04:29'),
(120, 4, 18, 0, '2026-04-15 13:04:29'),
(121, 4, 19, 0, '2026-04-15 13:04:29'),
(122, 4, 20, 0, '2026-04-15 13:04:29'),
(123, 4, 21, 0, '2026-04-15 13:04:29'),
(124, 4, 22, 0, '2026-04-15 13:04:29'),
(125, 4, 24, 0, '2026-04-15 13:04:29'),
(126, 4, 28, 0, '2026-04-15 13:04:29'),
(127, 4, 29, 0, '2026-04-15 13:04:29'),
(128, 4, 30, 0, '2026-04-15 13:04:29'),
(129, 4, 31, 0, '2026-04-15 13:04:29'),
(130, 4, 32, 0, '2026-04-15 13:04:29'),
(131, 4, 33, 0, '2026-04-15 13:04:29'),
(132, 4, 34, 0, '2026-04-15 13:04:29'),
(133, 4, 38, 0, '2026-04-15 13:04:29'),
(134, 4, 39, 0, '2026-04-15 13:04:29'),
(135, 4, 40, 0, '2026-04-15 13:04:29'),
(136, 4, 41, 0, '2026-04-15 13:04:29'),
(137, 4, 44, 0, '2026-04-15 13:04:29'),
(138, 4, 45, 0, '2026-04-15 13:04:29'),
(139, 4, 46, 0, '2026-04-15 13:04:29'),
(140, 4, 48, 0, '2026-04-15 07:12:38'),
(141, 4, 49, 0, '2026-04-15 13:04:29'),
(142, 4, 52, 0, '2026-04-15 13:04:29'),
(143, 4, 53, 0, '2026-04-15 13:04:29'),
(144, 4, 54, 0, '2026-04-15 13:04:29'),
(145, 4, 55, 0, '2026-04-15 13:04:29'),
(146, 2, 56, 1, '2026-04-15 08:11:12'),
(147, 4, 57, 0, '2026-04-15 13:04:29'),
(148, 4, 58, 0, '2026-04-15 13:04:29'),
(149, 4, 59, 0, '2026-04-15 13:04:29'),
(150, 4, 60, 0, '2026-04-15 13:04:29'),
(151, 4, 61, 0, '2026-04-15 13:04:29'),
(152, 4, 62, 0, '2026-04-15 13:04:29'),
(153, 4, 63, 0, '2026-04-15 13:04:29'),
(154, 4, 64, 0, '2026-04-15 13:04:29'),
(155, 4, 65, 0, '2026-04-15 13:04:29'),
(156, 4, 66, 0, '2026-04-15 13:04:29'),
(157, 4, 67, 0, '2026-04-15 13:04:29'),
(158, 4, 68, 0, '2026-04-15 13:04:29'),
(159, 4, 70, 0, '2026-04-15 13:04:29'),
(160, 4, 73, 0, '2026-04-15 13:04:29'),
(161, 4, 74, 0, '2026-04-15 13:04:29'),
(162, 4, 75, 0, '2026-04-15 13:04:29'),
(163, 4, 76, 0, '2026-04-15 13:04:29'),
(164, 4, 77, 0, '2026-04-15 13:04:29'),
(165, 4, 78, 0, '2026-04-15 13:04:29'),
(166, 4, 79, 0, '2026-04-15 13:04:29'),
(167, 4, 80, 0, '2026-04-15 13:04:29'),
(168, 4, 81, 0, '2026-04-15 13:04:29'),
(169, 4, 82, 0, '2026-04-15 13:04:29'),
(170, 4, 83, 0, '2026-04-15 13:04:29'),
(171, 4, 84, 0, '2026-04-15 13:04:29'),
(172, 4, 85, 0, '2026-04-15 13:04:29'),
(173, 4, 86, 0, '2026-04-15 13:04:29'),
(174, 4, 87, 0, '2026-04-15 13:04:29'),
(175, 4, 88, 0, '2026-04-15 13:04:29'),
(176, 4, 89, 0, '2026-04-15 13:04:29'),
(177, 4, 90, 0, '2026-04-15 13:04:29'),
(178, 4, 91, 0, '2026-04-15 13:04:29'),
(179, 4, 92, 0, '2026-04-15 13:04:29'),
(180, 4, 94, 0, '2026-04-15 13:04:29'),
(181, 4, 95, 0, '2026-04-15 13:04:29'),
(182, 4, 98, 0, '2026-04-15 13:04:29'),
(183, 4, 99, 0, '2026-04-15 13:04:29'),
(184, 4, 100, 0, '2026-04-15 13:04:29'),
(185, 4, 101, 0, '2026-04-15 13:04:29'),
(186, 4, 102, 0, '2026-04-15 13:04:29'),
(187, 4, 103, 0, '2026-04-15 13:04:29'),
(188, 4, 104, 0, '2026-04-15 13:04:29'),
(189, 4, 105, 0, '2026-04-15 13:04:29'),
(190, 4, 106, 0, '2026-04-15 13:04:29'),
(191, 4, 107, 0, '2026-04-15 13:04:29'),
(192, 4, 108, 0, '2026-04-15 13:04:29'),
(193, 4, 109, 0, '2026-04-15 13:04:29'),
(194, 4, 110, 0, '2026-04-15 13:04:29'),
(195, 4, 111, 0, '2026-04-15 13:04:29'),
(196, 4, 112, 0, '2026-04-15 13:04:29'),
(197, 4, 113, 0, '2026-04-15 13:04:29'),
(198, 4, 114, 0, '2026-04-15 13:04:29'),
(199, 4, 115, 0, '2026-04-15 13:04:29'),
(200, 4, 116, 0, '2026-04-15 13:04:29'),
(201, 4, 117, 0, '2026-04-15 13:04:29'),
(202, 4, 118, 0, '2026-04-15 13:04:29'),
(203, 4, 119, 0, '2026-04-15 13:04:29'),
(204, 4, 120, 0, '2026-04-15 13:04:29'),
(205, 4, 121, 0, '2026-04-15 13:04:29'),
(206, 4, 122, 0, '2026-04-15 13:04:29'),
(207, 4, 123, 0, '2026-04-15 13:04:29'),
(208, 4, 124, 0, '2026-04-15 13:04:29'),
(209, 4, 125, 0, '2026-04-15 13:04:29'),
(210, 4, 126, 0, '2026-04-15 13:04:29'),
(211, 4, 127, 0, '2026-04-15 13:04:29'),
(212, 4, 128, 0, '2026-04-15 13:04:29'),
(213, 4, 129, 0, '2026-04-15 13:04:29'),
(214, 4, 130, 0, '2026-04-15 13:04:29'),
(215, 4, 131, 0, '2026-04-15 13:04:29'),
(216, 4, 132, 0, '2026-04-15 13:04:29'),
(217, 4, 134, 0, '2026-04-15 13:04:29'),
(218, 4, 135, 0, '2026-04-15 13:04:29'),
(219, 4, 136, 0, '2026-04-15 13:04:29'),
(220, 4, 137, 0, '2026-04-15 13:04:29'),
(221, 4, 138, 0, '2026-04-15 13:04:29'),
(222, 4, 139, 0, '2026-04-15 13:04:29'),
(223, 4, 140, 0, '2026-04-15 13:04:29'),
(224, 4, 141, 0, '2026-04-15 13:04:29'),
(225, 4, 142, 0, '2026-04-15 13:04:29'),
(226, 4, 143, 0, '2026-04-15 13:04:29'),
(227, 4, 144, 0, '2026-04-15 13:04:29'),
(228, 4, 145, 0, '2026-04-15 13:04:29'),
(229, 4, 146, 0, '2026-04-15 13:04:29'),
(230, 1, 147, 0, '2026-04-15 13:28:17'),
(231, 2, 147, 0, '2026-04-16 11:37:52'),
(232, 3, 147, 1, '2026-04-15 14:42:45'),
(233, 4, 147, 0, '2026-04-15 13:28:17'),
(234, 1, 148, 0, '2026-04-15 13:56:02'),
(235, 2, 148, 1, '2026-04-15 14:40:45'),
(236, 3, 148, 1, '2026-04-15 14:40:45'),
(237, 4, 148, 0, '2026-04-15 13:56:02'),
(238, 1, 149, 0, '2026-04-15 13:57:14'),
(239, 2, 149, 0, '2026-04-15 13:57:14'),
(240, 3, 149, 1, '2026-04-15 14:03:00'),
(241, 4, 149, 0, '2026-04-15 13:57:14'),
(263, 1, 150, 0, '2026-04-15 16:07:03'),
(264, 2, 150, 2, '2026-04-15 16:07:03'),
(265, 3, 150, 0, '2026-04-15 16:07:03'),
(266, 4, 150, 0, '2026-04-15 16:07:03'),
(268, 5, 7, 0, '2026-04-15 17:11:06'),
(269, 5, 8, 0, '2026-04-15 17:11:06'),
(270, 5, 9, 0, '2026-04-15 17:11:06'),
(271, 5, 10, 0, '2026-04-15 17:11:06'),
(272, 5, 11, 0, '2026-04-15 17:11:06'),
(273, 5, 12, 0, '2026-04-15 17:11:06'),
(274, 5, 13, 0, '2026-04-15 17:11:06'),
(275, 5, 14, 0, '2026-04-15 17:11:06'),
(276, 5, 15, 0, '2026-04-15 17:11:06'),
(277, 5, 16, 0, '2026-04-15 17:11:06'),
(278, 5, 17, 0, '2026-04-15 17:11:06'),
(279, 5, 18, 0, '2026-04-15 17:11:06'),
(280, 5, 19, 0, '2026-04-15 17:11:06'),
(281, 5, 20, 0, '2026-04-15 17:11:06'),
(282, 5, 21, 0, '2026-04-15 17:11:06'),
(283, 5, 22, 0, '2026-04-15 17:11:06'),
(284, 5, 24, 0, '2026-04-15 17:11:06'),
(285, 5, 28, 0, '2026-04-15 17:11:06'),
(286, 5, 29, 0, '2026-04-15 17:11:06'),
(287, 5, 30, 0, '2026-04-15 17:11:06'),
(288, 5, 31, 0, '2026-04-15 17:11:06'),
(289, 5, 32, 0, '2026-04-15 17:11:06'),
(290, 5, 33, 0, '2026-04-15 17:11:06'),
(291, 5, 34, 0, '2026-04-15 17:11:06'),
(292, 5, 38, 0, '2026-04-15 17:11:06'),
(293, 5, 39, 0, '2026-04-15 17:11:06'),
(294, 5, 40, 0, '2026-04-15 17:11:06'),
(295, 5, 41, 0, '2026-04-15 17:11:06'),
(296, 5, 44, 0, '2026-04-15 17:11:06'),
(297, 5, 45, 0, '2026-04-15 17:11:06'),
(298, 5, 46, 0, '2026-04-15 17:11:06'),
(299, 5, 48, 0, '2026-04-15 17:11:06'),
(300, 5, 49, 0, '2026-04-15 17:11:06'),
(301, 5, 52, 0, '2026-04-15 17:11:06'),
(302, 5, 53, 0, '2026-04-15 17:11:06'),
(303, 5, 54, 0, '2026-04-15 17:11:06'),
(304, 5, 55, 0, '2026-04-15 17:11:06'),
(305, 5, 56, 0, '2026-04-15 17:11:06'),
(306, 5, 57, 0, '2026-04-15 17:11:06'),
(307, 5, 58, 0, '2026-04-15 17:11:06'),
(308, 5, 59, 0, '2026-04-15 17:11:06'),
(309, 5, 60, 0, '2026-04-15 17:11:06'),
(310, 5, 61, 0, '2026-04-15 17:11:06'),
(311, 5, 62, 0, '2026-04-15 17:11:06'),
(312, 5, 63, 0, '2026-04-15 17:11:06'),
(313, 5, 64, 0, '2026-04-15 17:11:06'),
(314, 5, 65, 0, '2026-04-15 17:11:06'),
(315, 5, 66, 0, '2026-04-15 17:11:06'),
(316, 5, 67, 0, '2026-04-15 17:11:06'),
(317, 5, 68, 0, '2026-04-15 17:11:06'),
(318, 5, 70, 0, '2026-04-15 17:11:06'),
(319, 5, 73, 0, '2026-04-15 17:11:06'),
(320, 5, 74, 0, '2026-04-15 17:11:06'),
(321, 5, 75, 0, '2026-04-15 17:11:06'),
(322, 5, 76, 0, '2026-04-15 17:11:06'),
(323, 5, 77, 0, '2026-04-15 17:11:06'),
(324, 5, 78, 0, '2026-04-15 17:11:06'),
(325, 5, 79, 0, '2026-04-15 17:11:06'),
(326, 5, 80, 0, '2026-04-15 17:11:06'),
(327, 5, 81, 0, '2026-04-15 17:11:06'),
(328, 5, 82, 0, '2026-04-15 17:11:06'),
(329, 5, 83, 0, '2026-04-15 17:11:06'),
(330, 5, 84, 0, '2026-04-15 17:11:06'),
(331, 5, 85, 0, '2026-04-15 17:11:06'),
(332, 5, 86, 0, '2026-04-15 17:11:06'),
(333, 5, 87, 0, '2026-04-15 17:11:06'),
(334, 5, 88, 0, '2026-04-15 17:11:06'),
(335, 5, 89, 0, '2026-04-15 17:11:06'),
(336, 5, 90, 0, '2026-04-15 17:11:06'),
(337, 5, 91, 0, '2026-04-15 17:11:06'),
(338, 5, 92, 0, '2026-04-15 17:11:06'),
(339, 5, 94, 0, '2026-04-15 17:11:06'),
(340, 5, 95, 0, '2026-04-15 17:11:06'),
(341, 5, 98, 0, '2026-04-15 17:11:06'),
(342, 5, 99, 0, '2026-04-15 17:11:06'),
(343, 5, 100, 0, '2026-04-15 17:11:06'),
(344, 5, 101, 0, '2026-04-15 17:11:06'),
(345, 5, 102, 0, '2026-04-15 17:11:06'),
(346, 5, 103, 0, '2026-04-15 17:11:06'),
(347, 5, 104, 0, '2026-04-15 17:11:06'),
(348, 5, 105, 0, '2026-04-15 17:11:06'),
(349, 5, 106, 0, '2026-04-15 17:11:06'),
(350, 5, 107, 0, '2026-04-15 17:11:06'),
(351, 5, 108, 0, '2026-04-15 17:11:06'),
(352, 5, 109, 0, '2026-04-15 17:11:06'),
(353, 5, 110, 0, '2026-04-15 17:11:06'),
(354, 5, 111, 0, '2026-04-15 17:11:06'),
(355, 5, 112, 0, '2026-04-15 17:11:06'),
(356, 5, 113, 0, '2026-04-15 17:11:06'),
(357, 5, 114, 0, '2026-04-15 17:11:06'),
(358, 5, 115, 0, '2026-04-15 17:11:06'),
(359, 5, 116, 0, '2026-04-15 17:11:06'),
(360, 5, 117, 0, '2026-04-15 17:11:06'),
(361, 5, 118, 0, '2026-04-15 17:11:06'),
(362, 5, 119, 0, '2026-04-15 17:11:06'),
(363, 5, 120, 0, '2026-04-15 17:11:06'),
(364, 5, 121, 0, '2026-04-15 17:11:06'),
(365, 5, 122, 0, '2026-04-15 17:11:06'),
(366, 5, 123, 0, '2026-04-15 17:11:06'),
(367, 5, 124, 0, '2026-04-15 17:11:06'),
(368, 5, 125, 0, '2026-04-15 17:11:06'),
(369, 5, 126, 0, '2026-04-15 17:11:06'),
(370, 5, 127, 0, '2026-04-15 17:11:06'),
(371, 5, 128, 0, '2026-04-15 17:11:06'),
(372, 5, 129, 0, '2026-04-15 17:11:06'),
(373, 5, 130, 0, '2026-04-15 17:11:06'),
(374, 5, 131, 0, '2026-04-15 17:11:06'),
(375, 5, 132, 0, '2026-04-15 17:11:06'),
(376, 5, 134, 0, '2026-04-15 17:11:06'),
(377, 5, 135, 0, '2026-04-15 17:11:06'),
(378, 5, 136, 0, '2026-04-15 17:11:06'),
(379, 5, 137, 0, '2026-04-15 17:11:06'),
(380, 5, 138, 0, '2026-04-15 17:11:06'),
(381, 5, 139, 0, '2026-04-15 17:11:06'),
(382, 5, 140, 0, '2026-04-15 17:11:06'),
(383, 5, 141, 0, '2026-04-15 17:11:06'),
(384, 5, 142, 0, '2026-04-15 17:11:06'),
(385, 5, 143, 0, '2026-04-15 17:11:06'),
(386, 5, 144, 0, '2026-04-15 17:11:06'),
(387, 5, 145, 0, '2026-04-15 17:11:06'),
(388, 5, 146, 0, '2026-04-15 17:11:06'),
(389, 5, 147, 0, '2026-04-15 17:11:06'),
(390, 5, 148, 0, '2026-04-15 17:11:06'),
(391, 5, 149, 0, '2026-04-15 17:11:06'),
(392, 5, 150, 0, '2026-04-15 17:11:06'),
(393, 3, 92, 1, '2026-04-15 17:42:35'),
(395, 3, 86, 1, '2026-04-17 15:12:59');

-- --------------------------------------------------------

--
-- Table structure for table `transferts`
--

CREATE TABLE `transferts` (
  `id` int(11) NOT NULL,
  `franchise_source` int(11) NOT NULL,
  `franchise_dest` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite` int(11) NOT NULL,
  `type_transfert` enum('transfert','dispatch') DEFAULT 'transfert',
  `statut` enum('en_attente','accepte','rejete') DEFAULT 'en_attente',
  `demandeur_id` int(11) DEFAULT NULL,
  `validateur_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `date_demande` datetime DEFAULT current_timestamp(),
  `date_validation` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transferts`
--

INSERT INTO `transferts` (`id`, `franchise_source`, `franchise_dest`, `produit_id`, `quantite`, `type_transfert`, `statut`, `demandeur_id`, `validateur_id`, `note`, `date_demande`, `date_validation`) VALUES
(1, 3, 2, 135, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-13 10:07:19', '2026-04-13 10:07:19'),
(2, 3, 2, 134, 2, 'dispatch', 'accepte', 1, 1, '', '2026-04-13 10:07:36', '2026-04-13 10:07:36'),
(3, 3, 2, 143, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:40:24', '2026-04-15 14:40:24'),
(4, 3, 2, 148, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:40:45', '2026-04-15 14:40:45'),
(5, 3, 2, 139, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:41:06', '2026-04-15 14:41:06'),
(6, 3, 2, 138, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:41:14', '2026-04-15 14:41:14'),
(7, 3, 2, 137, 2, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:41:26', '2026-04-15 14:41:26'),
(9, 3, 2, 140, 2, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:41:53', '2026-04-15 14:41:53'),
(10, 3, 2, 144, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:42:20', '2026-04-15 14:42:20'),
(11, 3, 2, 147, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 14:42:45', '2026-04-15 14:42:45'),
(12, 3, 2, 145, 1, 'dispatch', 'accepte', 1, 1, '', '2026-04-15 16:57:46', '2026-04-15 16:57:46'),
(13, 2, 3, 92, 1, 'transfert', 'accepte', 1, 1, 'non recu', '2026-04-15 17:42:26', '2026-04-15 17:42:35'),
(14, 2, 3, 86, 1, 'transfert', 'accepte', 1, 1, 'Produit défectueux ne charge pas', '2026-04-17 15:08:18', '2026-04-17 15:12:59');

-- --------------------------------------------------------

--
-- Table structure for table `tresorerie`
--

CREATE TABLE `tresorerie` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `type_mouvement` enum('encaissement','decaissement') NOT NULL,
  `montant` decimal(10,2) NOT NULL,
  `motif` varchar(255) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `date_mouvement` date DEFAULT curdate(),
  `utilisateur_id` int(11) DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tresorerie`
--

INSERT INTO `tresorerie` (`id`, `franchise_id`, `type_mouvement`, `montant`, `motif`, `reference`, `date_mouvement`, `utilisateur_id`, `date_creation`) VALUES
(1, 2, 'encaissement', '3187.00', 'Clôture journalière déclarée', 'CL-2026-04-15', '2026-04-15', 1, '2026-04-16 11:43:10'),
(2, 2, 'encaissement', '800.00', 'Clôture journalière déclarée', 'CL-2026-04-16', '2026-04-16', 1, '2026-04-16 11:44:50'),
(3, 2, 'decaissement', '89.00', 'support metalique pour ipad', 'BL 202604-83', '2026-04-14', 1, '2026-04-16 11:48:56'),
(4, 2, 'encaissement', '100.00', 'Lot échéance — Lot 2/2 — Facture TK-20260415-0006', 'FAC-7', '2026-04-18', 1, '2026-04-18 11:22:11'),
(5, 2, 'encaissement', '100.00', 'Lot échéance — Lot 1/2 — Facture TK-20260415-0006', 'FAC-7', '2026-04-18', 1, '2026-04-18 11:22:44'),
(6, 2, 'encaissement', '155.00', 'Lot échéance — Lot 1/4 — Facture TK-20260416-0001', 'FAC-18', '2026-04-20', 1, '2026-04-20 10:38:24'),
(7, 2, 'encaissement', '5000.00', 'Avance sur aménagement boutique', '', '2025-10-01', 1, '2026-04-20 17:34:39'),
(8, 2, 'decaissement', '74.00', 'Bidon peinture de 20kg', '', '2025-11-17', 1, '2026-04-20 17:47:40'),
(9, 2, 'decaissement', '148.00', '2 Sacs plastique de15 kg', '', '2025-11-17', 1, '2026-04-20 17:48:36'),
(10, 2, 'decaissement', '250.00', 'Honoraires peintre rached', '', '2025-11-17', 1, '2026-04-20 17:49:24'),
(11, 2, 'decaissement', '25.00', 'Achat pince a rivet', '', '2025-11-17', 1, '2026-04-20 17:50:15'),
(12, 2, 'decaissement', '20.00', 'Vis et autres accessoires quincaillerie', '', '2025-11-17', 1, '2026-04-20 17:51:37'),
(13, 2, 'encaissement', '9223.00', 'Encaissement crédit enda', '', '2025-12-01', 1, '2026-04-20 17:52:36'),
(14, 2, 'decaissement', '183.00', 'Abrasive et astique', '', '2025-12-11', 1, '2026-04-20 18:00:30'),
(15, 2, 'decaissement', '278.00', 'Facture comaf placoplâtre', '', '2025-12-12', 1, '2026-04-20 18:01:13'),
(16, 2, 'decaissement', '300.00', 'Peintre jamel pour la partie intérieure', '', '2025-12-12', 1, '2026-04-20 18:02:09'),
(17, 2, 'decaissement', '170.00', 'Facture bouchaala pour la séparation temporaire', '', '2025-12-12', 1, '2026-04-20 18:02:59'),
(18, 2, 'decaissement', '50.00', 'Transport placoplâtre transporteur issam', '', '2025-12-12', 1, '2026-04-20 18:04:01'),
(19, 2, 'decaissement', '147.00', 'Achat mastique et mastique de finition pour partie intérieure', '', '2025-12-19', 1, '2026-04-20 18:04:55'),
(20, 2, 'decaissement', '47.00', 'Achat applique led', '', '2026-01-04', 1, '2026-04-20 18:05:26'),
(21, 2, 'decaissement', '68.00', 'Achat moulure et autres accessoires pour travaux d\'électricité', '', '2026-01-04', 1, '2026-04-20 18:06:18'),
(22, 2, 'decaissement', '170.00', 'Honoraires électricien', '', '2026-01-04', 1, '2026-04-20 18:07:03'),
(23, 2, 'decaissement', '41.00', 'Produits de nettoyage', '', '2026-01-05', 1, '2026-04-20 18:07:36'),
(24, 2, 'decaissement', '50.00', 'Transport debarra de a boutique', '', '2026-01-06', 1, '2026-04-20 18:08:21'),
(25, 2, 'decaissement', '350.00', 'Honoraires peintre jamel', '', '2026-01-16', 1, '2026-04-20 18:08:55'),
(26, 2, 'decaissement', '68.00', 'Bidon de 40 kg flash', '', '2026-01-17', 1, '2026-04-20 18:09:49'),
(27, 2, 'decaissement', '60.00', 'Frais transport bureau de elmanar a la boutique', '', '2026-01-19', 1, '2026-04-20 18:10:34'),
(28, 2, 'decaissement', '1250.00', 'Salaire faouzi hadiji Octobre 2025', '', '2025-10-31', 1, '2026-04-20 18:11:51'),
(29, 2, 'decaissement', '1250.00', 'Salaire faouzi hadiji Novembre 2025', '', '2025-11-30', 1, '2026-04-20 18:12:31'),
(30, 2, 'decaissement', '1250.00', 'Salaire Faouzi Hadiji décembre 2025', '', '2025-12-31', 1, '2026-04-20 18:13:11'),
(31, 2, 'decaissement', '16.00', 'Support TV', '', '2026-02-18', 1, '2026-04-20 18:14:28'),
(32, 2, 'decaissement', '78.00', 'Verre pour étagère magasin', '', '2026-02-17', 1, '2026-04-20 18:14:59'),
(33, 2, 'decaissement', '48.00', 'Achat cadenins extérieurs', '', '2026-02-19', 1, '2026-04-20 18:15:22'),
(34, 2, 'encaissement', '98.00', 'Achat plantes plastiques d\'intérieur', '', '2026-02-19', 1, '2026-04-20 18:15:44'),
(35, 2, 'decaissement', '2500.00', 'Salaire Faouzi Hadiji mois de janvier 2026', '', '2026-01-31', 1, '2026-04-20 18:16:29'),
(36, 2, 'decaissement', '2500.00', 'Salaire Faouzi Hadiji mois de février 2026', '', '2026-02-28', 1, '2026-04-20 18:17:03'),
(37, 2, 'decaissement', '2500.00', 'Salaire Faouzi Hadiji mois de mars 2026', '', '2026-03-31', 1, '2026-04-20 18:17:41'),
(38, 2, 'decaissement', '196.00', 'Correction écriture achat plantes vertes intérieur', '', '2026-02-19', 1, '2026-04-20 18:19:15'),
(39, 2, 'encaissement', '400.00', 'Alimentation caisse de la part de Rihab', '', '2026-02-27', 1, '2026-04-20 18:20:00'),
(40, 2, 'decaissement', '22.60', 'Achat fils électrique, deux tourne vis et autres.', 'Sans factures', '2026-04-21', 1, '2026-04-21 13:50:25'),
(41, 2, 'decaissement', '200.00', 'Gagars jeux asel romdhan', '', '2026-03-31', 1, '2026-04-21 13:56:15'),
(42, 2, 'decaissement', '315.00', 'Frais banquière retrait espèce du crédit enda', '', '2025-12-04', 1, '2026-04-21 14:23:05'),
(43, 2, 'encaissement', '207.50', 'Lot échéance — Lot 1/2 — Facture TK-20260415-0015', 'FAC-16', '2026-04-21', 1, '2026-04-21 18:07:55'),
(44, 2, 'encaissement', '100.00', 'Lot échéance — Lot 1/2 — Facture TK-20260415-0015', 'FAC-16', '2026-04-22', 1, '2026-04-22 16:11:45');

-- --------------------------------------------------------

--
-- Table structure for table `utilisateurs`
--

CREATE TABLE `utilisateurs` (
  `id` int(11) NOT NULL,
  `nom_utilisateur` varchar(50) NOT NULL,
  `mot_de_passe` varchar(255) NOT NULL,
  `nom_complet` varchar(100) NOT NULL,
  `prenom` varchar(100) DEFAULT '',
  `cin` varchar(8) DEFAULT NULL,
  `telephone` varchar(20) DEFAULT '',
  `role` enum('admin','franchise','gestionnaire','viewer') NOT NULL,
  `custom_permissions` text DEFAULT NULL,
  `franchise_id` int(11) DEFAULT NULL,
  `actif` tinyint(4) DEFAULT 1,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `utilisateurs`
--

INSERT INTO `utilisateurs` (`id`, `nom_utilisateur`, `mot_de_passe`, `nom_complet`, `prenom`, `cin`, `telephone`, `role`, `custom_permissions`, `franchise_id`, `actif`, `date_creation`) VALUES
(1, 'admin', '$2y$10$GDDJ.1TI5pPR7OkRWZZBZ.nFAl079siP9XuuOIf35ujzLMzxkfxj.', 'Hdiji', 'Faouzi', '05321144', '47001500', 'admin', NULL, NULL, 1, '2026-04-03 07:16:57'),
(2, 'mourouj', '$2y$10$JTUZJ.koZoh1rp1j.QkBQuzbZiGHSrlHYlUOKh/F8Y3HbubxXIdx6', 'Gérant Mourouj', '', NULL, '', 'franchise', NULL, 1, 1, '2026-04-03 07:16:57'),
(3, 'soukra', '$2y$10$6cVSet.MkkPIluGGwhfe3urWUkKn631d0sgush9I8yPKIPwD8TxUa', 'Gérant Soukra', 'Faouzi', '05321144', '47001500', 'franchise', NULL, 2, 1, '2026-04-03 07:16:57'),
(4, 'stock', '$2y$10$FvvPRP8UbTGyLdFhlmPg6e1SCKnrnWklLuhmCUshvENaxwV7rA0oe', 'Osman', 'Ramzi', '', '', 'gestionnaire', NULL, NULL, 1, '2026-04-03 08:44:12'),
(5, 'intileka', '$2y$10$q6GhiRz3xMMurHmWiHwVBeLfrIjGZUOr4KrCvvSr486tPDtDtYGpC', 'Gérant Intileka', '', NULL, '', 'franchise', NULL, 4, 1, '2026-04-15 20:38:03'),
(11, 'vsaleh', '$2y$10$cE0e/kabcsegT52EpK41ZO9mAQ16AYqnQClKcEn9JmACELvgb804u', 'Touil', '', '', '', '', '{\"+\":[\"pos\",\"vente\",\"create_facture\",\"add_client\",\"pay_facture\",\"pay_echeance\",\"create_echeance\",\"create_echeances_lot\",\"vente_recharge\"]}', 2, 1, '2026-04-22 17:29:49');

-- --------------------------------------------------------

--
-- Table structure for table `ventes`
--

CREATE TABLE `ventes` (
  `id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `produit_id` int(11) NOT NULL,
  `quantite` int(11) NOT NULL,
  `prix_unitaire` decimal(10,2) NOT NULL,
  `prix_total` decimal(10,2) NOT NULL,
  `remise` decimal(5,2) DEFAULT 0.00,
  `mode_paiement` enum('especes','carte','virement','cheque','echeance') DEFAULT 'especes',
  `montant_recu` decimal(10,2) DEFAULT 0.00,
  `monnaie` decimal(10,2) DEFAULT 0.00,
  `date_vente` date DEFAULT curdate(),
  `utilisateur_id` int(11) DEFAULT NULL,
  `client_id` int(11) DEFAULT NULL,
  `facture_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `date_creation` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ventes`
--

INSERT INTO `ventes` (`id`, `franchise_id`, `produit_id`, `quantite`, `prix_unitaire`, `prix_total`, `remise`, `mode_paiement`, `montant_recu`, `monnaie`, `date_vente`, `utilisateur_id`, `client_id`, `facture_id`, `note`, `date_creation`) VALUES
(1, 2, 11, 3, '15.01', '45.00', '0.03', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(2, 2, 10, 1, '15.01', '15.00', '0.01', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(3, 2, 13, 1, '30.00', '10.00', '20.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(4, 2, 20, 2, '22.00', '44.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(5, 2, 9, 3, '15.00', '30.00', '15.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(6, 2, 106, 1, '20.00', '20.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(7, 2, 8, 5, '18.00', '90.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(8, 2, 34, 1, '30.00', '30.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(9, 2, 29, 1, '50.00', '50.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(10, 2, 33, 1, '30.00', '30.00', '0.00', 'especes', '364.00', '0.00', '2026-04-15', 1, NULL, 1, NULL, '2026-04-15 15:42:51'),
(11, 2, 107, 2, '25.00', '50.00', '0.00', 'especes', '65.00', '0.00', '2026-04-15', 1, NULL, 2, NULL, '2026-04-15 15:53:27'),
(12, 2, 15, 1, '15.00', '15.00', '0.00', 'especes', '65.00', '0.00', '2026-04-15', 1, NULL, 2, NULL, '2026-04-15 15:53:27'),
(13, 2, 115, 2, '15.01', '30.00', '0.02', 'especes', '0.00', '0.00', '2026-04-15', 1, NULL, 3, NULL, '2026-04-15 16:26:33'),
(14, 2, 126, 1, '65.00', '65.00', '0.00', 'especes', '0.00', '0.00', '2026-04-15', 1, NULL, 3, NULL, '2026-04-15 16:26:33'),
(15, 2, 103, 1, '60.00', '60.00', '0.00', 'especes', '0.00', '0.00', '2026-04-15', 1, NULL, 3, NULL, '2026-04-15 16:26:33'),
(16, 2, 76, 1, '420.00', '420.00', '0.00', 'echeance', '320.00', '0.00', '2026-04-15', 1, 3, 4, NULL, '2026-04-15 16:42:30'),
(17, 2, 81, 1, '450.00', '450.00', '0.00', 'echeance', '300.00', '0.00', '2026-04-15', 1, 4, 5, NULL, '2026-04-15 16:46:05'),
(18, 2, 134, 1, '1250.00', '1250.00', '0.00', 'echeance', '350.00', '0.00', '2026-04-15', 1, 12, 6, NULL, '2026-04-15 16:51:13'),
(19, 2, 79, 1, '320.00', '320.00', '0.00', 'echeance', '130.00', '0.00', '2026-04-15', 1, 5, 7, NULL, '2026-04-15 16:52:27'),
(20, 2, 145, 1, '330.00', '330.00', '0.00', 'echeance', '450.00', '0.00', '2026-04-15', 1, 7, 8, NULL, '2026-04-15 17:00:32'),
(21, 2, 80, 1, '550.02', '550.00', '0.02', 'echeance', '450.00', '0.00', '2026-04-15', 1, 7, 8, NULL, '2026-04-15 17:00:32'),
(22, 2, 75, 1, '360.00', '360.00', '0.00', 'echeance', '200.00', '0.00', '2026-04-15', 1, 6, 9, NULL, '2026-04-15 17:01:54'),
(23, 2, 77, 1, '495.00', '480.00', '15.00', 'echeance', '200.00', '0.00', '2026-04-15', 1, 13, 10, NULL, '2026-04-15 17:04:53'),
(24, 2, 83, 1, '350.00', '350.00', '0.00', 'echeance', '150.00', '0.00', '2026-04-15', 1, 9, 11, NULL, '2026-04-15 17:06:33'),
(25, 2, 87, 2, '45.00', '83.00', '7.00', 'especes', '83.00', '0.00', '2026-04-15', 1, NULL, 12, NULL, '2026-04-15 17:13:18'),
(26, 2, 88, 1, '45.00', '40.00', '5.00', 'especes', '45.00', '5.00', '2026-04-15', 1, NULL, 13, NULL, '2026-04-15 17:15:38'),
(27, 2, 78, 1, '570.00', '570.00', '0.00', 'echeance', '170.00', '0.00', '2026-04-15', 1, 10, 14, NULL, '2026-04-15 17:37:03'),
(28, 2, 89, 2, '65.00', '130.00', '0.00', 'especes', '130.00', '0.00', '2026-04-15', 1, NULL, 15, NULL, '2026-04-15 17:38:04'),
(29, 2, 82, 1, '495.00', '495.00', '0.00', 'echeance', '80.00', '0.00', '2026-04-15', 1, 11, 16, NULL, '2026-04-15 17:49:52'),
(30, 2, 143, 1, '575.00', '540.00', '35.00', 'echeance', '0.00', '0.00', '2026-04-15', 1, 14, 17, NULL, '2026-04-15 17:52:03'),
(31, 2, 147, 1, '620.00', '620.00', '0.00', 'echeance', '0.00', '0.00', '2026-04-16', 1, 4, 18, NULL, '2026-04-16 11:37:52'),
(32, 2, 135, 1, '2250.00', '2200.00', '50.00', 'echeance', '800.00', '0.00', '2026-04-16', 1, 15, 19, NULL, '2026-04-16 11:40:46'),
(33, 2, 124, 1, '50.00', '0.00', '50.00', 'especes', '0.00', '0.00', '2026-04-16', 1, NULL, 20, NULL, '2026-04-16 12:46:29'),
(35, 2, 137, 1, '65.00', '65.00', '0.00', 'especes', '65.00', '0.00', '2026-04-17', 1, NULL, 22, NULL, '2026-04-17 15:00:11'),
(36, 2, 61, 1, '30.00', '30.00', '0.00', 'especes', '25.00', '0.00', '2026-04-17', 1, NULL, 23, NULL, '2026-04-17 15:27:45'),
(37, 2, 20, 1, '22.00', '22.00', '0.00', 'especes', '0.00', '0.00', '2026-04-20', 1, NULL, 24, NULL, '2026-04-20 17:02:49');

-- --------------------------------------------------------

--
-- Table structure for table `ventes_asel`
--

CREATE TABLE `ventes_asel` (
  `id` int(11) NOT NULL,
  `produit_asel_id` int(11) NOT NULL,
  `franchise_id` int(11) NOT NULL,
  `client_id` int(11) DEFAULT NULL,
  `numero_telephone` varchar(20) DEFAULT NULL,
  `prix_vente` decimal(10,2) NOT NULL,
  `commission` decimal(10,2) DEFAULT 0.00,
  `utilisateur_id` int(11) DEFAULT NULL,
  `facture_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `date_vente` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_date` (`date_creation`),
  ADD KEY `idx_user` (`utilisateur_id`),
  ADD KEY `idx_action` (`action`);

--
-- Indexes for table `bons_reception`
--
ALTER TABLE `bons_reception`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `numero` (`numero`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- Indexes for table `bon_reception_lignes`
--
ALTER TABLE `bon_reception_lignes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `bon_id` (`bon_id`),
  ADD KEY `produit_id` (`produit_id`);

--
-- Indexes for table `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nom` (`nom`);

--
-- Indexes for table `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tel` (`telephone`),
  ADD KEY `idx_type` (`type_client`);

--
-- Indexes for table `clotures`
--
ALTER TABLE `clotures`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_cloture` (`franchise_id`,`date_cloture`);

--
-- Indexes for table `clotures_mensuelles`
--
ALTER TABLE `clotures_mensuelles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_cloture_mens` (`franchise_id`,`mois`);

--
-- Indexes for table `demandes_produits`
--
ALTER TABLE `demandes_produits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- Indexes for table `echeances`
--
ALTER TABLE `echeances`
  ADD PRIMARY KEY (`id`),
  ADD KEY `facture_id` (`facture_id`),
  ADD KEY `idx_date` (`date_echeance`,`statut`),
  ADD KEY `idx_client` (`client_id`);

--
-- Indexes for table `factures`
--
ALTER TABLE `factures`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `numero` (`numero`),
  ADD KEY `franchise_id` (`franchise_id`),
  ADD KEY `idx_numero` (`numero`),
  ADD KEY `idx_date` (`date_facture`);

--
-- Indexes for table `facture_lignes`
--
ALTER TABLE `facture_lignes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `facture_id` (`facture_id`);

--
-- Indexes for table `familles`
--
ALTER TABLE `familles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nom` (`nom`);

--
-- Indexes for table `fournisseurs`
--
ALTER TABLE `fournisseurs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `franchises`
--
ALTER TABLE `franchises`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nom` (`nom`);

--
-- Indexes for table `horaires`
--
ALTER TABLE `horaires`
  ADD PRIMARY KEY (`id`),
  ADD KEY `utilisateur_id` (`utilisateur_id`);

--
-- Indexes for table `inventaires`
--
ALTER TABLE `inventaires`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_inv` (`franchise_id`,`mois`);

--
-- Indexes for table `inventaire_lignes`
--
ALTER TABLE `inventaire_lignes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inventaire_id` (`inventaire_id`),
  ADD KEY `produit_id` (`produit_id`);

--
-- Indexes for table `mouvements`
--
ALTER TABLE `mouvements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `franchise_id` (`franchise_id`),
  ADD KEY `produit_id` (`produit_id`),
  ADD KEY `idx_date` (`date_mouvement`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user` (`utilisateur_id`,`lu`),
  ADD KEY `idx_franchise` (`franchise_id`,`lu`),
  ADD KEY `idx_role` (`role_cible`,`lu`);

--
-- Indexes for table `pointages`
--
ALTER TABLE `pointages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_date` (`utilisateur_id`,`heure`),
  ADD KEY `idx_franchise_date` (`franchise_id`,`heure`);

--
-- Indexes for table `points_acces`
--
ALTER TABLE `points_acces`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `points_reseau`
--
ALTER TABLE `points_reseau`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_type` (`type_point`),
  ADD KEY `idx_statut` (`statut`),
  ADD KEY `idx_ville` (`ville`),
  ADD KEY `idx_actif` (`actif`);

--
-- Indexes for table `prestations`
--
ALTER TABLE `prestations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `service_id` (`service_id`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- Indexes for table `produits`
--
ALTER TABLE `produits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `categorie_id` (`categorie_id`),
  ADD KEY `idx_code_barre` (`code_barre`),
  ADD KEY `idx_reference` (`reference`);

--
-- Indexes for table `produits_asel`
--
ALTER TABLE `produits_asel`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `produit_fournisseurs`
--
ALTER TABLE `produit_fournisseurs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_prod_fourn` (`produit_id`,`fournisseur_id`),
  ADD KEY `idx_produit` (`produit_id`),
  ADD KEY `idx_fournisseur` (`fournisseur_id`);

--
-- Indexes for table `retours`
--
ALTER TABLE `retours`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `services`
--
ALTER TABLE `services`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sous_categories`
--
ALTER TABLE `sous_categories`
  ADD PRIMARY KEY (`id`),
  ADD KEY `categorie_id` (`categorie_id`);

--
-- Indexes for table `stock`
--
ALTER TABLE `stock`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_stock` (`franchise_id`,`produit_id`),
  ADD KEY `produit_id` (`produit_id`);

--
-- Indexes for table `transferts`
--
ALTER TABLE `transferts`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `tresorerie`
--
ALTER TABLE `tresorerie`
  ADD PRIMARY KEY (`id`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- Indexes for table `utilisateurs`
--
ALTER TABLE `utilisateurs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nom_utilisateur` (`nom_utilisateur`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- Indexes for table `ventes`
--
ALTER TABLE `ventes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `produit_id` (`produit_id`),
  ADD KEY `idx_date_vente` (`date_vente`),
  ADD KEY `idx_franchise_date` (`franchise_id`,`date_vente`);

--
-- Indexes for table `ventes_asel`
--
ALTER TABLE `ventes_asel`
  ADD PRIMARY KEY (`id`),
  ADD KEY `produit_asel_id` (`produit_asel_id`),
  ADD KEY `franchise_id` (`franchise_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `audit_logs`
--
ALTER TABLE `audit_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=311;

--
-- AUTO_INCREMENT for table `bons_reception`
--
ALTER TABLE `bons_reception`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `bon_reception_lignes`
--
ALTER TABLE `bon_reception_lignes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=258;

--
-- AUTO_INCREMENT for table `categories`
--
ALTER TABLE `categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT for table `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `clotures`
--
ALTER TABLE `clotures`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `clotures_mensuelles`
--
ALTER TABLE `clotures_mensuelles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `demandes_produits`
--
ALTER TABLE `demandes_produits`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `echeances`
--
ALTER TABLE `echeances`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=41;

--
-- AUTO_INCREMENT for table `factures`
--
ALTER TABLE `factures`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=25;

--
-- AUTO_INCREMENT for table `facture_lignes`
--
ALTER TABLE `facture_lignes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=38;

--
-- AUTO_INCREMENT for table `familles`
--
ALTER TABLE `familles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `fournisseurs`
--
ALTER TABLE `fournisseurs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `franchises`
--
ALTER TABLE `franchises`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `horaires`
--
ALTER TABLE `horaires`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `inventaires`
--
ALTER TABLE `inventaires`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `inventaire_lignes`
--
ALTER TABLE `inventaire_lignes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=92;

--
-- AUTO_INCREMENT for table `mouvements`
--
ALTER TABLE `mouvements`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=256;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;

--
-- AUTO_INCREMENT for table `pointages`
--
ALTER TABLE `pointages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `points_acces`
--
ALTER TABLE `points_acces`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `points_reseau`
--
ALTER TABLE `points_reseau`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `prestations`
--
ALTER TABLE `prestations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `produits`
--
ALTER TABLE `produits`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=151;

--
-- AUTO_INCREMENT for table `produits_asel`
--
ALTER TABLE `produits_asel`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=57;

--
-- AUTO_INCREMENT for table `produit_fournisseurs`
--
ALTER TABLE `produit_fournisseurs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=70;

--
-- AUTO_INCREMENT for table `retours`
--
ALTER TABLE `retours`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `services`
--
ALTER TABLE `services`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `sous_categories`
--
ALTER TABLE `sous_categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `stock`
--
ALTER TABLE `stock`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=396;

--
-- AUTO_INCREMENT for table `transferts`
--
ALTER TABLE `transferts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `tresorerie`
--
ALTER TABLE `tresorerie`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=45;

--
-- AUTO_INCREMENT for table `utilisateurs`
--
ALTER TABLE `utilisateurs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `ventes`
--
ALTER TABLE `ventes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=38;

--
-- AUTO_INCREMENT for table `ventes_asel`
--
ALTER TABLE `ventes_asel`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `bons_reception`
--
ALTER TABLE `bons_reception`
  ADD CONSTRAINT `bons_reception_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `demandes_produits`
--
ALTER TABLE `demandes_produits`
  ADD CONSTRAINT `demandes_produits_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `echeances`
--
ALTER TABLE `echeances`
  ADD CONSTRAINT `echeances_ibfk_1` FOREIGN KEY (`facture_id`) REFERENCES `factures` (`id`),
  ADD CONSTRAINT `echeances_ibfk_2` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`);

--
-- Constraints for table `factures`
--
ALTER TABLE `factures`
  ADD CONSTRAINT `factures_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `facture_lignes`
--
ALTER TABLE `facture_lignes`
  ADD CONSTRAINT `facture_lignes_ibfk_1` FOREIGN KEY (`facture_id`) REFERENCES `factures` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `horaires`
--
ALTER TABLE `horaires`
  ADD CONSTRAINT `horaires_ibfk_1` FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateurs` (`id`);

--
-- Constraints for table `inventaires`
--
ALTER TABLE `inventaires`
  ADD CONSTRAINT `inventaires_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `inventaire_lignes`
--
ALTER TABLE `inventaire_lignes`
  ADD CONSTRAINT `inventaire_lignes_ibfk_1` FOREIGN KEY (`inventaire_id`) REFERENCES `inventaires` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `inventaire_lignes_ibfk_2` FOREIGN KEY (`produit_id`) REFERENCES `produits` (`id`);

--
-- Constraints for table `mouvements`
--
ALTER TABLE `mouvements`
  ADD CONSTRAINT `mouvements_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`),
  ADD CONSTRAINT `mouvements_ibfk_2` FOREIGN KEY (`produit_id`) REFERENCES `produits` (`id`);

--
-- Constraints for table `pointages`
--
ALTER TABLE `pointages`
  ADD CONSTRAINT `pointages_ibfk_1` FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateurs` (`id`);

--
-- Constraints for table `prestations`
--
ALTER TABLE `prestations`
  ADD CONSTRAINT `prestations_ibfk_1` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`),
  ADD CONSTRAINT `prestations_ibfk_2` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `produits`
--
ALTER TABLE `produits`
  ADD CONSTRAINT `produits_ibfk_1` FOREIGN KEY (`categorie_id`) REFERENCES `categories` (`id`);

--
-- Constraints for table `sous_categories`
--
ALTER TABLE `sous_categories`
  ADD CONSTRAINT `sous_categories_ibfk_1` FOREIGN KEY (`categorie_id`) REFERENCES `categories` (`id`);

--
-- Constraints for table `stock`
--
ALTER TABLE `stock`
  ADD CONSTRAINT `stock_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`),
  ADD CONSTRAINT `stock_ibfk_2` FOREIGN KEY (`produit_id`) REFERENCES `produits` (`id`);

--
-- Constraints for table `tresorerie`
--
ALTER TABLE `tresorerie`
  ADD CONSTRAINT `tresorerie_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `utilisateurs`
--
ALTER TABLE `utilisateurs`
  ADD CONSTRAINT `utilisateurs_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);

--
-- Constraints for table `ventes`
--
ALTER TABLE `ventes`
  ADD CONSTRAINT `ventes_ibfk_1` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`),
  ADD CONSTRAINT `ventes_ibfk_2` FOREIGN KEY (`produit_id`) REFERENCES `produits` (`id`);

--
-- Constraints for table `ventes_asel`
--
ALTER TABLE `ventes_asel`
  ADD CONSTRAINT `ventes_asel_ibfk_1` FOREIGN KEY (`produit_asel_id`) REFERENCES `produits_asel` (`id`),
  ADD CONSTRAINT `ventes_asel_ibfk_2` FOREIGN KEY (`franchise_id`) REFERENCES `franchises` (`id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;